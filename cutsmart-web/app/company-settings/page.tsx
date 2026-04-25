"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Building2, CircleDollarSign, DatabaseBackup, Gauge, GripVertical, HardHat, Layers3, Link2, Package2, Plus, Settings, Users, Wrench, X } from "lucide-react";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import {
  createCompanyInviteDetailed,
  fetchCompanyDoc,
  fetchCompanyMembers,
  fetchProjects,
  removeTagsFromCompanyProjects,
  fetchUserColorMapByUids,
  fetchUserNotifications,
  saveCompanyDocPatchDetailed,
  setAllUserNotificationsRead,
  type CompanyMemberOption,
  type UserNotificationRow,
} from "@/lib/firestore-data";
import { storage } from "@/lib/firebase";
import { QUOTE_TEMPLATE_PLACEHOLDERS } from "@/lib/quote-template-placeholders";

type SettingsSection =
  | "company" | "dashboard" | "sales" | "production" | "nesting" | "materials"
  | "hardware" | "staff" | "notifications" | "integrations" | "backup";

type StatusRow = { name: string; color: string };
type SheetSizeRow = { h: string; w: string; isDefault: boolean };
type BoardColourMemoryRow = { value: string; count: string };
type RoleRow = { id: string; name: string; color: string; permissions: string[] };
type DashboardLegendRow = { id: string; name: string; color: string };
type TagUsageRow = { value: string; count: string };
type ItemCategoryItemRow = { name: string; subcategory: string; price: string; markupPercent: string };
type ItemCategoryRow = { name: string; color: string; subcategories: string; items: ItemCategoryItemRow[] };
type JobTypeSheetPriceRow = { sheetSize: string; pricePerSheet: string };
type JobTypeRow = { name: string; sheetPrices: JobTypeSheetPriceRow[]; showInSales: boolean; grain: boolean };
type EdgebandingRuleRow = { upToMeters: string; addMeters: string };
type PartTypeRow = {
  name: string;
  color: string;
  cabinetry: boolean;
  drawer: boolean;
  autoClashLeft: string;
  autoClashRight: string;
  initialMeasure: boolean;
  inCutlists: boolean;
  inNesting: boolean;
};
type QuoteExtraRow = { id: string; name: string; price: string; defaultIncluded: boolean; templateContainerId: string; templateBlockId: string; templatePlaceholderKey: string };
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

const desktopPermissionKeys = [
  "company.dashboard.view",
  "projects.create",
  "projects.view",
  "projects.view.others",
  "projects.status",
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
];

const deletedRetentionOptions: Array<{ label: string; days: string }> = [
  { label: "1 day", days: "1" },
  { label: "1 week", days: "7" },
  { label: "2 weeks", days: "14" },
  { label: "1 month", days: "30" },
  { label: "2 months", days: "60" },
  { label: "3 months", days: "90" },
  { label: "4 months", days: "120" },
  { label: "6 months", days: "180" },
  { label: "1 year", days: "365" },
];

const cutlistColumnDefaults = ["Board", "Part Name", "Height", "Width", "Depth", "Quantity", "Clashing", "Information", "Grain"];
const autoClashLeftOptions = ["1L", "2L"];
const autoClashRightOptions = ["1S", "2S"];

const sections: Array<{ key: SettingsSection; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { key: "company", label: "Company", icon: Building2 },
  { key: "dashboard", label: "Dashboard", icon: Gauge },
  { key: "sales", label: "Sales", icon: CircleDollarSign },
  { key: "production", label: "Production", icon: Wrench },
  { key: "nesting", label: "Nesting Settings", icon: Layers3 },
  { key: "materials", label: "Materials & Board Types", icon: Package2 },
  { key: "hardware", label: "Hardware", icon: HardHat },
  { key: "staff", label: "Staff & Permissions", icon: Users },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "integrations", label: "Integrations", icon: Link2 },
  { key: "backup", label: "Backup Data", icon: DatabaseBackup },
];
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY = "cutsmart_active_company_theme_color";

function toStr(v: unknown, fallback = "") {
  const t = String(v ?? "").trim();
  return t || fallback;
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

function Panel({ title, headerRight, children }: { title: string; headerRight?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-[#F8FAFD] shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-center justify-between gap-2 border-b border-[#DCE3EC] bg-white px-3 py-2">
        <p className="text-[13px] font-extrabold uppercase tracking-[1px] text-[#1E3A62]">{title}</p>
        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
      </div>
      <div className="bg-[#F8FAFD] p-3">{children}</div>
    </section>
  );
}

function normalizeStatuses(raw: unknown): StatusRow[] {
  if (!Array.isArray(raw)) {
    return [
      { name: "New", color: "#3060D0" },
      { name: "In Production", color: "#2A7A3B" },
      { name: "Completed", color: "#2A7A3B" },
    ];
  }
  const out = raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return { name: toStr(row.name), color: toStr(row.color, "#64748B") };
    })
    .filter((row) => row.name);
  return out.length ? out : [{ name: "New", color: "#3060D0" }];
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

function normalizeRoles(raw: unknown): RoleRow[] {
  if (!Array.isArray(raw)) {
    return [
      { id: "owner", name: "Owner", color: "#1F2937", permissions: [] },
      { id: "admin", name: "Admin", color: "#2F6BFF", permissions: [] },
      { id: "staff", name: "Staff", color: "#7D99B3", permissions: [] },
    ];
  }
  const out = raw
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => {
      const row = item as Record<string, unknown>;
      const permissionsObj = row.permissions && typeof row.permissions === "object" ? (row.permissions as Record<string, unknown>) : {};
      const permissions = Object.entries(permissionsObj).filter(([, v]) => Boolean(v)).map(([k]) => String(k));
      return {
        id: toStr(row.id, `role_${idx + 1}`),
        name: toStr(row.name, `Role ${idx + 1}`),
        color: toStr(row.color, "#7D99B3"),
        permissions,
      };
    });
  return out.length ? out : [{ id: "staff", name: "Staff", color: "#7D99B3", permissions: [] }];
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

function normalizeBoardColourMemory(raw: unknown): BoardColourMemoryRow[] {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const colours = Array.isArray(obj.colours) ? obj.colours : [];
    return colours
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const item = row as Record<string, unknown>;
        return { value: toStr(item.value), count: toStr(item.count ?? 0, "0") };
      })
      .filter((row) => row.value)
      .sort((a, b) => Number(b.count) - Number(a.count) || a.value.localeCompare(b.value));
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Record<string, unknown>;
      return { value: toStr(item.value ?? item.colour ?? item.color), count: toStr(item.count ?? 0, "0") };
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
        grain: Boolean(row.grain ?? row.isGrain ?? false),
      };
    })
    .filter((r) => r.name);
}

function normalizePartTypes(raw: unknown): PartTypeRow[] {
  const defaults: PartTypeRow[] = [
    { name: "Front", color: "#F2D57A", cabinetry: false, drawer: false, autoClashLeft: "", autoClashRight: "", initialMeasure: true, inCutlists: true, inNesting: true },
    { name: "Panel", color: "#C6E8AE", cabinetry: false, drawer: false, autoClashLeft: "", autoClashRight: "", initialMeasure: true, inCutlists: true, inNesting: true },
    { name: "Extra", color: "#B7A4EB", cabinetry: false, drawer: false, autoClashLeft: "", autoClashRight: "", initialMeasure: false, inCutlists: true, inNesting: true },
    { name: "Drawer", color: "#B8D8F8", cabinetry: false, drawer: true, autoClashLeft: "", autoClashRight: "", initialMeasure: false, inCutlists: true, inNesting: true },
    { name: "Cabinet", color: "#4B5563", cabinetry: true, drawer: false, autoClashLeft: "", autoClashRight: "", initialMeasure: false, inCutlists: true, inNesting: true },
    { name: "Special Panel", color: "#BF1D1D", cabinetry: false, drawer: false, autoClashLeft: "", autoClashRight: "", initialMeasure: false, inCutlists: true, inNesting: false },
  ];
  if (!Array.isArray(raw)) return defaults;
  const out = raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      const name = toStr(row.name);
      return {
        name,
        color: toStr(row.color, "#7D99B3"),
        cabinetry: Boolean(row.cabinetry ?? row.isCabinetry ?? false),
        drawer: Boolean(row.drawer ?? row.isDrawer ?? false),
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

function normalizeQuoteExtras(raw: unknown): QuoteExtraRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => {
      const row = item as Record<string, unknown>;
      const name = toStr(row.name);
      return {
        id: toStr(row.id, `quote_extra_${(name || "row").toLowerCase().replace(/[^a-z0-9]+/g, "_") || "row"}_${idx + 1}`),
        name,
        price: toStr(row.price),
        defaultIncluded: Boolean(row.defaultIncluded ?? row.default),
        templateContainerId: toStr(row.templateContainerId),
        templateBlockId: toStr(row.templateBlockId),
        templatePlaceholderKey: toStr(row.templatePlaceholderKey),
      };
    })
    .filter((r) => r.name);
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

function normalizeQuoteTemplateContainers(raw: unknown): Array<{ id: string; title: string }> {
  if (!raw || typeof raw !== "object") return [];
  const row = raw as Record<string, unknown>;
  const containers = Array.isArray(row.containers) ? row.containers : [];
  if (containers.length) {
    return containers
      .map((item, idx) => {
        if (!item || typeof item !== "object") return null;
        const container = item as Record<string, unknown>;
        const id = toStr(container.id);
        if (!id) return null;
        return {
          id,
          title: toStr(container.title, `Container ${idx + 1}`),
        };
      })
      .filter(Boolean) as Array<{ id: string; title: string }>;
  }
  const sections = Array.isArray(row.sections) ? row.sections : [];
  return sections
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const section = item as Record<string, unknown>;
      return {
        id: toStr(section.id, `legacy_container_${idx + 1}`),
        title: toStr(section.title, `Container ${idx + 1}`),
      };
    })
    .filter(Boolean) as Array<{ id: string; title: string }>;
}

function normalizeQuoteTemplateBlocks(raw: unknown): Array<{ id: string; label: string }> {
  if (!raw || typeof raw !== "object") return [];
  const row = raw as Record<string, unknown>;
  const containers = Array.isArray(row.containers) ? row.containers : [];
  const out: Array<{ id: string; label: string }> = [];
  containers.forEach((containerItem, containerIdx) => {
    if (!containerItem || typeof containerItem !== "object") return;
    const container = containerItem as Record<string, unknown>;
    const columns = Array.isArray(container.columns) ? container.columns : [];
    columns.forEach((columnItem) => {
      if (!columnItem || typeof columnItem !== "object") return;
      const column = columnItem as Record<string, unknown>;
      const blocks = Array.isArray(column.blocks) ? column.blocks : [];
      blocks.forEach((blockItem, blockIdx) => {
        if (!blockItem || typeof blockItem !== "object") return;
        const block = blockItem as Record<string, unknown>;
        const id = toStr(block.id);
        if (!id) return;
        const label = toStr(block.label, `Element ${containerIdx + 1}.${blockIdx + 1}`);
        out.push({ id, label });
      });
    });
  });
  return out;
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
  const [active, setActive] = useState<SettingsSection>("company");
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState<Record<string, unknown> | null>(null);
  const [activeCompanyId, setActiveCompanyId] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!activeCompanyId) return;
    window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, activeCompanyId);
  }, [activeCompanyId]);
  const [staff, setStaff] = useState<CompanyMemberOption[]>([]);
  const [staffIconColorByUid, setStaffIconColorByUid] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [saveLabel, setSaveLabel] = useState("Desktop parity data mode");
  const [isHydrated, setIsHydrated] = useState(false);
  const blurAutoSaveTimerRef = useRef<number | null>(null);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);
  const hasPendingBlurSaveRef = useRef(false);
  const saveQueuedWhileBusyRef = useRef(false);
  const skipFirstDirtyEffectRef = useRef(true);
  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  const [dashboardLegend, setDashboardLegend] = useState<DashboardLegendRow[]>([]);
  const [legendDragIndex, setLegendDragIndex] = useState<number | null>(null);
  const [legendDragOverIndex, setLegendDragOverIndex] = useState<number | null>(null);
  const [statusDragIndex, setStatusDragIndex] = useState<number | null>(null);
  const [statusDragOverIndex, setStatusDragOverIndex] = useState<number | null>(null);
  const [projectTagUsage, setProjectTagUsage] = useState<TagUsageRow[]>([]);
  const [boardColourMemory, setBoardColourMemory] = useState<BoardColourMemoryRow[]>([]);
  const [boardThicknesses, setBoardThicknesses] = useState<string[]>(["16", "18"]);
  const [boardFinishes, setBoardFinishes] = useState<string[]>(["Satin"]);
  const [sheetSizes, setSheetSizes] = useState<SheetSizeRow[]>([{ h: "2440", w: "1220", isDefault: true }]);
  const [partTypes, setPartTypes] = useState<PartTypeRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [itemCategories, setItemCategories] = useState<ItemCategoryRow[]>([]);
  const [itemCategoryExpanded, setItemCategoryExpanded] = useState<Record<number, boolean>>({});
  const [itemCategoryDragIndex, setItemCategoryDragIndex] = useState<number | null>(null);
  const [itemCategoryDragOverIndex, setItemCategoryDragOverIndex] = useState<number | null>(null);
  const [jobTypes, setJobTypes] = useState<JobTypeRow[]>([]);
  const [jobTypeExpanded, setJobTypeExpanded] = useState<Record<number, boolean>>({});
  const [jobTypeDragIndex, setJobTypeDragIndex] = useState<number | null>(null);
  const [jobTypeDragOverIndex, setJobTypeDragOverIndex] = useState<number | null>(null);
  const [quoteExtras, setQuoteExtras] = useState<QuoteExtraRow[]>([]);
  const [quoteHelpers, setQuoteHelpers] = useState<QuoteHelperRow[]>([]);
  const [quoteExtraDragIndex, setQuoteExtraDragIndex] = useState<number | null>(null);
  const [quoteExtraDragOverIndex, setQuoteExtraDragOverIndex] = useState<number | null>(null);
  const [quoteHelperDragIndex, setQuoteHelperDragIndex] = useState<number | null>(null);
  const [quoteHelperDragOverIndex, setQuoteHelperDragOverIndex] = useState<number | null>(null);
  const [discountTiers, setDiscountTiers] = useState<DiscountTierRow[]>([]);
  const [discountTierDragIndex, setDiscountTierDragIndex] = useState<number | null>(null);
  const [discountTierDragOverIndex, setDiscountTierDragOverIndex] = useState<number | null>(null);
  const [minusOffQuoteTotal, setMinusOffQuoteTotal] = useState(false);
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
  const [nesting, setNesting] = useState({ sheetHeight: "2440", sheetWidth: "1220", kerf: "5", margin: "10" });
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
  const [unlockSuffix, setUnlockSuffix] = useState("");
  const [unlockHours, setUnlockHours] = useState("6");
  const [backupTemplate, setBackupTemplate] = useState<BackupTemplateSettings>({
    quoteTemplateHeaderHtml: "",
    quoteTemplateFooterHtml: "",
    quoteTemplatePageSize: "A4",
    quoteTemplateMarginMm: "10",
    quoteTemplateFooterPinBottom: false,
  });
  const quoteTemplateContainerOptions = useMemo(
    () => normalizeQuoteTemplateContainers((company as Record<string, unknown> | null)?.quoteLayoutTemplate),
    [company],
  );
  const quoteTemplateBlockOptions = useMemo(
    () => normalizeQuoteTemplateBlocks((company as Record<string, unknown> | null)?.quoteLayoutTemplate),
    [company],
  );
  const quoteTemplatePlaceholderOptions = useMemo(() => QUOTE_TEMPLATE_PLACEHOLDERS, []);
  const [notificationsRows, setNotificationsRows] = useState<UserNotificationRow[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [isInvitingStaff, setIsInvitingStaff] = useState(false);
  const [showJoinKey, setShowJoinKey] = useState(false);
  const [form, setForm] = useState({
    name: "",
    defaultCurrency: "NZD - New Zealand Dollar",
    measurementUnit: "mm",
    dateFormat: "DD/MM/YYYY",
    timeZone: "Pacific/Auckland",
    deletedRetentionDays: "90",
    themeColor: "#2F6BFF",
    logoPath: "",
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!form?.themeColor) return;
    window.localStorage.setItem(ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY, String(form.themeColor));
  }, [form.themeColor]);

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

      try {
        const projects = await fetchProjects(user.uid);
        for (const project of projects) {
          addCandidate(project.companyId);
        }
      } catch {
        // ignore project-based fallback errors
      }

      let selectedCompanyId = "";
      let doc: Record<string, unknown> | null = null;
      for (const companyId of candidateIds) {
        // Try each candidate until we find a readable company doc.
        const hit = await fetchCompanyDoc(companyId);
        if (hit) {
          selectedCompanyId = companyId;
          doc = hit;
          break;
        }
      }

      setActiveCompanyId(selectedCompanyId);
      const members = selectedCompanyId ? await fetchCompanyMembers(selectedCompanyId) : [];
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
          deletedRetentionDays: toStr(doc.deletedRetentionDays, "90"),
          themeColor: toStr(doc.themeColor, "#2F6BFF"),
          logoPath: toStr(doc.logoPath),
        });
        setStatuses(normalizeStatuses(doc.projectStatuses));
        setDashboardLegend(normalizeDashboardLegend(doc.dashboardCompleteLegend));
        setProjectTagUsage(normalizeProjectTagUsage(doc.projectTagUsage));
        setBoardColourMemory(normalizeBoardColourMemory(doc.boardMaterialUsage));
        setBoardThicknesses(normalizeStringList(doc.boardThicknesses, ["16", "18"]));
        setBoardFinishes(normalizeStringList(doc.boardFinishes, ["Satin"]));
        setSheetSizes(normalizeSheetSizes(doc.sheetSizes));
        setPartTypes(normalizePartTypes(doc.partTypes));
        setRoles(normalizeRoles(doc.roles));
        setItemCategories(normalizeItemCategories(doc.itemCategories));
        setJobTypes(normalizeJobTypes(doc.salesJobTypes));
        setQuoteExtras(normalizeQuoteExtras(doc.quoteExtras));
        setQuoteHelpers(normalizeQuoteHelpers(doc.salesQuoteHelpers));
        setDiscountTiers(normalizeDiscountTiers(doc.salesQuoteDiscountTiers));
        setMinusOffQuoteTotal(Boolean(doc.salesMinusOffQuoteTotal));
        const hardwareRows = normalizeHardware(doc.hardwareSettings);
        setHardware(sanitizeHardwareRows(hardwareRows));
        setNesting({
          sheetHeight: toStr(nestingRaw.sheetHeight, "2440"),
          sheetWidth: toStr(nestingRaw.sheetWidth, "1220"),
          kerf: toStr(nestingRaw.kerf, "5"),
          margin: toStr(nestingRaw.margin, "10"),
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
        setUnlockSuffix(toStr(doc.productionUnlockPasswordSuffix));
        setUnlockHours(toStr(doc.productionUnlockDurationHours, "6"));
        setBackupTemplate({
          quoteTemplateHeaderHtml: toStr(doc.quoteTemplateHeaderHtml),
          quoteTemplateFooterHtml: toStr(doc.quoteTemplateFooterHtml),
          quoteTemplatePageSize: toStr(doc.quoteTemplatePageSize, "A4"),
          quoteTemplateMarginMm: toStr(doc.quoteTemplateMarginMm, "10"),
          quoteTemplateFooterPinBottom: Boolean(doc.quoteTemplateFooterPinBottom),
        });
      }
      setNotificationsLoading(true);
      const notifications = await fetchUserNotifications(user.uid);
      setNotificationsRows(notifications);
      setNotificationsLoading(false);
      setIsHydrated(true);
      setIsLoading(false);
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
      const colorMap = await fetchUserColorMapByUids(uids);
      setStaffIconColorByUid(colorMap);
    };
    void run();
  }, [staff]);

  useEffect(() => {
    if (active !== "hardware") return;
    setHardwareExpanded({});
    setDrawerRowExpanded({});
    setDrawerHeightsExpanded({});
  }, [active]);

  const filteredSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter((s) => s.label.toLowerCase().includes(q));
  }, [search]);

  const currentMemberRole = useMemo(() => {
    const fromMembership = staff.find((m) => m.uid === user?.uid)?.role;
    const fromUser = (user as { role?: string } | null)?.role;
    return String(fromMembership ?? fromUser ?? "").trim().toLowerCase();
  }, [staff, user]);

  const canAddStaff = useMemo(() => {
    if (currentMemberRole === "owner" || currentMemberRole === "admin") {
      return true;
    }
    const perms = Array.isArray(user?.permissions) ? user.permissions : [];
    return perms.some((p) => String(p).trim().toLowerCase() === "staff.add");
  }, [currentMemberRole, user?.permissions]);

  const inviteStaffFromTopBar = async () => {
    if (!activeCompanyId || !canAddStaff || isInvitingStaff) {
      return;
    }
    const email = window.prompt("Invite staff by email");
    const cleanEmail = String(email || "").trim();
    if (!cleanEmail) return;
    if (!cleanEmail.includes("@")) {
      setSaveLabel("Invite failed (invalid email)");
      return;
    }

    setIsInvitingStaff(true);
    const companyCode = toStr(company?.joinCode ?? company?.companyCode ?? company?.joinPassword ?? company?.companyPassword);
    const result = await createCompanyInviteDetailed(activeCompanyId, cleanEmail, {
      companyName: toStr(form.name || company?.name || company?.companyName || activeCompanyId),
      companyCode,
      invitedByUid: String(user?.uid || ""),
      invitedByName: String(user?.displayName || user?.email || ""),
    });
    if (result.ok) {
      setSaveLabel(`Invite sent: ${cleanEmail}`);
    } else {
      setSaveLabel(`Invite failed (${result.error || "unknown"})`);
    }
    setIsInvitingStaff(false);
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

  const addItemCategorySubcategory = (index: number) => {
    const input = window.prompt("Sub-category name");
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

  const ensureDollarFormat = (value: string) => {
    const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return "$0.00";
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
    return `$${out.toFixed(2)}`;
  };

  const formatDiscountCurrency = (value: string) => ensureDollarFormat(value);

  const addItemCategoryItem = (index: number) => {
    setItemCategories((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const firstSub = parseSubcategoryNames(row.subcategories)[0] ?? "";
        const nextItems = [...(row.items ?? []), { name: "", subcategory: firstSub, price: "$0.00", markupPercent: "0" }];
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
        return { ...row, sheetPrices: [...(row.sheetPrices ?? []), { sheetSize: defaultValue, pricePerSheet: "$0.00" }] };
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
        salesJobTypes: jobTypes,
        quoteExtras,
        salesQuoteHelpers: quoteHelpers,
        salesQuoteDiscountTiers: discountTiers,
        salesMinusOffQuoteTotal: minusOffQuoteTotal,
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

  const deleteStorageObjectIfExists = async (value: string) => {
    const client = storage;
    const raw = String(value || "").trim();
    if (!client || !raw) return;
    try {
      if (/^https?:\/\//i.test(raw) || /^gs:\/\//i.test(raw)) {
        await deleteObject(storageRef(client, raw));
        return;
      }
      await deleteObject(storageRef(client, raw));
    } catch {
      // best effort
    }
  };

  const onUploadCompanyLogo = async (file: File | null) => {
    if (!file || !activeCompanyId) return;
    const client = storage;
    if (!client) {
      setSaveLabel("Save failed (storage-unavailable)");
      return;
    }
    setIsUploadingLogo(true);
    const previousLogoPath = toStr(form.logoPath);
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

      if (previousLogoPath && previousLogoPath !== nextUrl) {
        await deleteStorageObjectIfExists(previousLogoPath);
      }
    } catch {
      setSaveLabel("Save failed (logo-upload-failed)");
    } finally {
      setIsUploadingLogo(false);
      if (logoFileInputRef.current) {
        logoFileInputRef.current.value = "";
      }
    }
  };

  const markAllNotifications = async (read: boolean) => {
    if (!user?.uid) {
      return;
    }
    setNotificationsLoading(true);
    const ok = await setAllUserNotificationsRead(user.uid, read);
    if (ok) {
      const next = await fetchUserNotifications(user.uid);
      setNotificationsRows(next);
      setSaveLabel(read ? "Notifications marked read" : "Notifications marked unread");
    } else {
      setSaveLabel("Notification update failed");
    }
    setNotificationsLoading(false);
  };

  const save = async (mode: "manual" | "auto" = "manual") => {
    if (!activeCompanyId || isSaving) return;
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
      deletedRetentionDays: Number(form.deletedRetentionDays || 90),
      themeColor: form.themeColor,
      logoPath: form.logoPath,
      projectStatuses: statuses.map((row, idx) => ({
        id: toStr(row.name, `status_${idx + 1}`).toLowerCase().replace(/\s+/g, "_"),
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
      boardMaterialUsage: {
        colours: boardColourMemory
          .map((row) => {
            const value = toStr(row.value);
            if (!value) return null;
            return { value, count: Number(row.count || 0) };
          })
          .filter(Boolean),
      },
      boardThicknesses: boardThicknesses.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0),
      boardFinishes: boardFinishes.map((v) => toStr(v)).filter(Boolean),
      sheetSizes: sheetSizes
        .map((r) => ({ h: Number(r.h), w: Number(r.w), isDefault: r.isDefault }))
        .filter((r) => Number.isFinite(r.h) && Number.isFinite(r.w) && r.h > 0 && r.w > 0),
      partTypes: partTypes
        .map((row) => {
          const name = toStr(row.name);
          if (!name) return null;
          return {
            name,
            color: toStr(row.color, "#7D99B3"),
            cabinetry: Boolean(row.cabinetry),
            drawer: Boolean(row.drawer),
            autoClashLeft: toStr(row.autoClashLeft),
            autoClashRight: toStr(row.autoClashRight),
            initialMeasure: Boolean(row.initialMeasure),
            inCutlists: Boolean(row.inCutlists),
            inNesting: Boolean(row.inNesting),
          };
        })
        .filter(Boolean),
      nestingSettings: {
        sheetHeight: Number(nesting.sheetHeight || 2440),
        sheetWidth: Number(nesting.sheetWidth || 1220),
        kerf: Number(nesting.kerf || 5),
        margin: Number(nesting.margin || 10),
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
      productionUnlockPasswordSuffix: unlockSuffix.replace(/\D/g, ""),
      productionUnlockDurationHours: Number(unlockHours || 6),
      roles: roles
        .map((row) => {
          const id = toStr(row.id, toStr(row.name).toLowerCase().replace(/\s+/g, "_"));
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
                subcategory: toStr(item.subcategory),
                price: ensureDollarFormat(toStr(item.price, "$0.00")),
                markupPercent: toStr(item.markupPercent, "0"),
              };
            })
            .filter(Boolean);
          return { name, color: toStr(row.color, "#7D99B3"), subcategories, items };
        })
        .filter(Boolean),
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
            grain: Boolean(row.grain),
          };
        })
        .filter(Boolean),
      quoteExtras: quoteExtras
        .map((row) => {
          const name = toStr(row.name);
          if (!name) return null;
          return {
            id: toStr(row.id),
            name,
            price: toStr(row.price),
            defaultIncluded: Boolean(row.defaultIncluded),
            templateContainerId: toStr(row.templateContainerId),
            templateBlockId: toStr(row.templateBlockId),
            templatePlaceholderKey: toStr(row.templatePlaceholderKey),
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
            drawers: parseJsonList(row.drawersJson),
            hinges: parseJsonList(row.hingesJson),
            other: parseJsonList(row.otherJson),
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
      setCompany((prev) => ({
        ...(prev ?? {}),
        ...form,
        projectStatuses: statuses,
        dashboardCompleteLegend: dashboardLegend,
        projectTagUsage: { tags: projectTagUsage },
        boardMaterialUsage: { colours: boardColourMemory },
        boardThicknesses,
        boardFinishes,
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
        productionUnlockPasswordSuffix: unlockSuffix,
        productionUnlockDurationHours: unlockHours,
        roles,
        itemCategories,
        salesJobTypes: jobTypes,
        quoteExtras,
        salesQuoteHelpers: quoteHelpers,
        salesQuoteDiscountTiers: discountTiers,
        salesMinusOffQuoteTotal: minusOffQuoteTotal,
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

  const triggerBlurAutoSave = () => {
    if (!isHydrated || isLoading || !activeCompanyId) {
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
      void save("auto");
    }, 120);
  };

  const triggerAutosaveAfterRowDrop = () => {
    hasPendingBlurSaveRef.current = true;
    triggerBlurAutoSave();
  };

  useEffect(() => {
    if (!isHydrated || isLoading || !activeCompanyId) return;
    if (skipFirstDirtyEffectRef.current) {
      skipFirstDirtyEffectRef.current = false;
      return;
    }
    hasPendingBlurSaveRef.current = true;
    setSaveLabel("Unsaved changes");
  }, [
    isHydrated,
    isLoading,
    activeCompanyId,
    form,
    statuses,
    dashboardLegend,
    projectTagUsage,
    boardColourMemory,
    boardThicknesses,
    boardFinishes,
    sheetSizes,
    partTypes,
    roles,
    itemCategories,
    jobTypes,
    quoteExtras,
    quoteHelpers,
    discountTiers,
    minusOffQuoteTotal,
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
    <ProtectedRoute>
      <AppShell>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-[12px] border border-[#D7DEE8] bg-white px-3 py-2">
            <div className="flex items-center gap-2">
              <Settings size={18} />
              <h1 className="text-[34px] font-bold text-[#111827]">Settings</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-[6px] border border-[#DCE3EC] bg-white px-2 py-[2px] text-[11px] font-semibold text-[#94A3B8]">{isLoading ? "Loading..." : saveLabel}</span>
              <button onClick={() => void save()} disabled={isSaving || isLoading} className="h-9 rounded-[10px] bg-[#1EA44B] px-4 text-[13px] font-bold text-white disabled:opacity-60">{isSaving ? "Saving..." : "Save Changes"}</button>
            </div>
          </div>

          <div className="grid min-h-[calc(100vh-170px)] gap-3 lg:grid-cols-[190px_1fr]">
            <aside className="rounded-[14px] border border-[#D7DEE8] bg-white p-2 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search settings..." className="mb-2 h-8 w-full rounded-[8px] border border-[#DCE3EC] bg-[#F4F6FA] px-2 text-[12px] outline-none" />
              <div className="space-y-1 border-b border-[#E4E9F0] pb-3">
                {filteredSections.map((item) => {
                  const Icon = item.icon;
                  const selected = active === item.key;
                  return (
                    <button key={item.key} type="button" onClick={() => setActive(item.key)} className={`inline-flex w-full items-center gap-2 rounded-[9px] px-2 py-[7px] text-left text-[12px] font-bold ${selected ? "bg-[#DDE7F5] text-[#244C7F]" : "text-[#334155] hover:bg-[#EEF2F7]"}`}>
                      <Icon size={14} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 rounded-[10px] border border-[#E4E9F0] bg-[#F8FAFD] p-2 text-[11px] text-[#475467]">
                <p><span className="font-bold text-[#344054]">Company Name</span> {toStr(company?.name, "Unknown")}</p>
                <p><span className="font-bold text-[#344054]">Company ID</span> {toStr(company?.id, activeCompanyId)}</p>
                <p><span className="font-bold text-[#344054]">Plan</span> {toStr(company?.planName, "Free")}</p>
                <p><span className="font-bold text-[#344054]">Join Key</span> {showJoinKey ? toStr(company?.joinKey ?? company?.joinCode, "------") : "------"}</p>
                <button
                  type="button"
                  onClick={() => setShowJoinKey((v) => !v)}
                  className="mt-2 h-7 w-full rounded-[8px] border border-[#DCE3EC] bg-[#EEF2F7] text-[11px] font-bold text-[#475467]"
                >
                  {showJoinKey ? "Hide key" : "Show key"}
                </button>
              </div>
            </aside>

            <main
              className="space-y-3 overflow-auto pr-1"
              onInputCapture={(e) => {
                const el = e.target as HTMLElement | null;
                const tag = String(el?.tagName || "").toLowerCase();
                if (tag === "input" || tag === "textarea" || tag === "select") {
                  hasPendingBlurSaveRef.current = true;
                }
              }}
              onChangeCapture={(e) => {
                const el = e.target as HTMLElement | null;
                const tag = String(el?.tagName || "").toLowerCase();
                if (tag === "input" || tag === "textarea" || tag === "select") {
                  hasPendingBlurSaveRef.current = true;
                }
              }}
              onBlurCapture={(e) => {
                const el = e.target as HTMLElement | null;
                const tag = String(el?.tagName || "").toLowerCase();
                if (tag === "input" || tag === "textarea" || tag === "select") {
                  triggerBlurAutoSave();
                }
              }}
            >
              {active === "company" && (
                <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr]">
                  <Panel title="Application Preferences">
                    <div className="space-y-2 text-[12px]">
                      <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                        <p className="font-bold text-[#334155]">Company Name</p>
                        <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                      </div>
                      <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                        <p className="font-bold text-[#334155]">Default Currency</p>
                        <input value={form.defaultCurrency} onChange={(e) => setForm((prev) => ({ ...prev, defaultCurrency: e.target.value }))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                      </div>
                      <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                        <p className="font-bold text-[#334155]">Measurement Unit</p>
                        <div className="inline-flex items-center gap-4">
                          <label className="inline-flex items-center gap-1 font-semibold text-[#475467]"><input type="checkbox" checked={form.measurementUnit === "mm"} onChange={() => setForm((prev) => ({ ...prev, measurementUnit: "mm" }))} />mm</label>
                          <label className="inline-flex items-center gap-1 font-semibold text-[#475467]"><input type="checkbox" checked={form.measurementUnit === "inches"} onChange={() => setForm((prev) => ({ ...prev, measurementUnit: "inches" }))} />inches</label>
                        </div>
                      </div>
                      <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                        <p className="font-bold text-[#334155]">Date Format</p>
                        <input value={form.dateFormat} onChange={(e) => setForm((prev) => ({ ...prev, dateFormat: e.target.value }))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                      </div>
                      <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                        <p className="font-bold text-[#334155]">Time Zone</p>
                        <input value={form.timeZone} onChange={(e) => setForm((prev) => ({ ...prev, timeZone: e.target.value }))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                      </div>
                      <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                        <p className="font-bold text-[#334155]">Recently Deleted Time</p>
                        <select
                          value={form.deletedRetentionDays}
                          onChange={(e) => setForm((prev) => ({ ...prev, deletedRetentionDays: e.target.value }))}
                          className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                        >
                          {deletedRetentionOptions.map((opt) => (
                            <option key={opt.days} value={opt.days}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </Panel>
                  <Panel title="Theme">
                    <div className="space-y-2 text-[12px]">
                      <div className="grid grid-cols-[95px_1fr] items-center gap-2">
                        <p className="font-bold text-[#334155]">Theme Color</p>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={/^#[0-9A-Fa-f]{6}$/.test(form.themeColor) ? form.themeColor : "#2F6BFF"}
                            onChange={(e) => setForm((prev) => ({ ...prev, themeColor: e.target.value }))}
                            className="h-7 w-9 cursor-pointer rounded-[8px] border border-[#D8DEE8] bg-white p-1"
                          />
                          <input
                            value={form.themeColor}
                            onChange={(e) => setForm((prev) => ({ ...prev, themeColor: e.target.value }))}
                            className="h-7 flex-1 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-[95px_1fr_auto] items-center gap-2">
                        <p className="font-bold text-[#334155]">Company Logo</p>
                        <input
                          value={form.logoPath}
                          onChange={(e) => setForm((prev) => ({ ...prev, logoPath: e.target.value }))}
                          className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                        />
                        <div className="flex items-center gap-2">
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
                          <button
                            type="button"
                            onClick={() => logoFileInputRef.current?.click()}
                            disabled={isUploadingLogo || isLoading || !activeCompanyId}
                            className="h-7 rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] px-3 text-[11px] font-bold text-[#475467] disabled:opacity-60"
                          >
                            {isUploadingLogo ? "Uploading..." : "Upload"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </Panel>
                </div>
              )}

              {active === "materials" && (
                <div className="grid gap-3 xl:grid-cols-2">
                  <Panel title="Sheet Thicknesses">
                    <div className="space-y-2 text-[12px]">
                      <div className="grid grid-cols-[26px_1fr_30px] gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                        <p></p>
                        <p>Thickness</p>
                        <p>Unit</p>
                      </div>
                      {boardThicknesses.map((value, idx) => (
                        <div key={idx} className="grid grid-cols-[26px_1fr_30px] items-center gap-2">
                          <button
                            onClick={() => setBoardThicknesses((prev) => prev.filter((_, i) => i !== idx))}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                          >
                            <X size={15} strokeWidth={2.8} />
                          </button>
                          <input value={value} onChange={(e) => setBoardThicknesses((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                          <p className="py-1 font-bold text-[#64748B]">mm</p>
                        </div>
                      ))}
                      <button onClick={() => setBoardThicknesses((prev) => [...prev, ""])} className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]">+ Add</button>
                    </div>
                  </Panel>
                  <Panel title="Board Finishes">
                    <div className="space-y-2 text-[12px]">
                      <div className="grid grid-cols-[26px_1fr] gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                        <p></p>
                        <p>Finish</p>
                      </div>
                      {boardFinishes.map((value, idx) => (
                        <div key={idx} className="grid grid-cols-[26px_1fr] items-center gap-2">
                          <button
                            onClick={() => setBoardFinishes((prev) => prev.filter((_, i) => i !== idx))}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                          >
                            <X size={15} strokeWidth={2.8} />
                          </button>
                          <input value={value} onChange={(e) => setBoardFinishes((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                        </div>
                      ))}
                      <button onClick={() => setBoardFinishes((prev) => [...prev, ""])} className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]">+ Add</button>
                    </div>
                  </Panel>
                  <Panel title="Sheet Sizes">
                    <div className="space-y-2 text-[12px]">
                      <div className="grid grid-cols-[26px_1fr_1fr_60px] items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                        <p></p>
                        <p>Height</p>
                        <p>Width</p>
                        <p>Default</p>
                      </div>
                      {sheetSizes.map((row, idx) => (
                        <div key={idx} className="grid grid-cols-[26px_1fr_1fr_60px] items-center gap-2">
                          <button
                            onClick={() => setSheetSizes((prev) => prev.filter((_, i) => i !== idx))}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                          >
                            <X size={15} strokeWidth={2.8} />
                          </button>
                          <input value={row.h} onChange={(e) => setSheetSizes((prev) => prev.map((r, i) => (i === idx ? { ...r, h: e.target.value } : r)))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                          <input value={row.w} onChange={(e) => setSheetSizes((prev) => prev.map((r, i) => (i === idx ? { ...r, w: e.target.value } : r)))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                          {(() => {
                            const hasDefault = sheetSizes.some((r) => r.isDefault);
                            if (hasDefault && !row.isDefault) {
                              return <div className="h-7" />;
                            }
                            return (
                              <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#475467]">
                                <input
                                  type="checkbox"
                                  checked={row.isDefault}
                                  onChange={() =>
                                    setSheetSizes((prev) =>
                                      prev.map((r, i) => {
                                        if (i === idx) return { ...r, isDefault: !r.isDefault };
                                        return { ...r, isDefault: false };
                                      }),
                                    )
                                  }
                                />
                                Default
                              </label>
                            );
                          })()}
                        </div>
                      ))}
                      <button onClick={() => setSheetSizes((prev) => [...prev, { h: "", w: "", isDefault: false }])} className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]">+ Add</button>
                    </div>
                  </Panel>
                  <Panel title="Board Colour Memory">
                    <div className="space-y-2 text-[12px]">
                      <div className="grid grid-cols-[26px_1fr_70px] items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                        <p></p>
                        <p>Colour</p>
                        <p className="text-center">Used</p>
                      </div>
                      {boardColourMemory.map((row, idx) => (
                        <div key={`board_colour_${idx}`} className="grid grid-cols-[26px_1fr_70px] items-center gap-2">
                          <button
                            onClick={() => setBoardColourMemory((prev) => prev.filter((_, i) => i !== idx))}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                          >
                            <X size={15} strokeWidth={2.8} />
                          </button>
                          <div className="inline-flex h-7 items-center rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] text-[#334155]">
                            {row.value}
                          </div>
                          <div className="inline-flex h-7 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] font-semibold text-[#334155]">
                            {String(row.count || "0")}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </div>
              )}

              {active === "integrations" && (
                <div className="space-y-3">
                  <Panel title="Quote Layout Builder">
                    <div className="space-y-3 text-[12px]">
                      <p className="text-[11px] text-[#6B7280]">
                        Build the company quote layout once, then use that same template across every project.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => router.push("/company-settings/quote-layout")}
                          className="h-8 rounded-[10px] bg-[#1EA44B] px-4 text-[12px] font-bold text-white shadow-[0_1px_2px_rgba(16,24,40,0.08)]"
                        >
                          Open Quote Layout Builder
                        </button>
                        <span className="rounded-[8px] border border-[#D8DEE8] bg-white px-3 py-[6px] text-[11px] font-semibold text-[#475467]">
                          Company-wide template
                        </span>
                      </div>
                    </div>
                  </Panel>
                </div>
              )}

              {active === "nesting" && (
                <div className="w-full xl:w-1/2">
                  <Panel title="Nesting Settings">
                    <div className="grid gap-2 text-[12px] xl:grid-cols-2">
                      {[
                        ["Sheet Height", "sheetHeight"],
                        ["Sheet Width", "sheetWidth"],
                        ["Kerf", "kerf"],
                        ["Margin", "margin"],
                      ].map(([label, key]) => (
                        <div key={key} className="grid grid-cols-[102px_88px_24px] items-center gap-1">
                          <p className="font-bold text-[#334155]">{label}</p>
                          <input
                            value={nesting[key as keyof typeof nesting]}
                            onChange={(e) => setNesting((prev) => ({ ...prev, [key]: e.target.value }))}
                            className="h-7 w-[88px] rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] text-center"
                          />
                          <p className="font-bold text-[#64748B]">mm</p>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </div>
              )}

              {active === "production" && (
                <div className="grid gap-3 xl:grid-cols-2">
                  <Panel title="Cutlist Columns">
                    <div className="space-y-2 text-[12px]">
                      <div className="flex items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                        <p className="w-7 shrink-0"></p>
                        <p className="min-w-0 flex-1">Column</p>
                        <p className="w-[120px] shrink-0 text-center">Production</p>
                        <p className="w-[120px] shrink-0 text-center">Initial Measure</p>
                      </div>
                      {cutlistColumnRows.map((columnName) => {
                        const prodChecked = cutlistProduction.includes(columnName);
                        const initialChecked = cutlistInitial.includes(columnName);
                        const idx = cutlistColumnRows.findIndex((v) => v === columnName);
                        return (
                          <div
                            key={columnName}
                            className={`flex items-center gap-2 rounded-[8px] ${
                              cutlistColumnDragIndex === idx
                                ? "bg-[#EEF3FA]"
                                : cutlistColumnDragOverIndex === idx
                                  ? "bg-[#F7FAFF]"
                                  : ""
                            }`}
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
                              triggerAutosaveAfterRowDrop();
                            }}
                          >
                            <button
                              type="button"
                              draggable
                              onDragStart={(e) => {
                                setCutlistColumnDragIndex(idx);
                                setCutlistColumnDragOverIndex(idx);
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={() => {
                                setCutlistColumnDragIndex(null);
                                setCutlistColumnDragOverIndex(null);
                              }}
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-white text-[#98A2B3]"
                              title="Drag to reorder"
                            >
                              <GripVertical size={14} />
                            </button>
                            <div className="h-7 min-w-0 flex-1 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] leading-[28px] text-[#334155]">
                              {columnName}
                            </div>
                            <label className="inline-flex w-[120px] shrink-0 items-center justify-center">
                              <input
                                type="checkbox"
                                checked={prodChecked}
                                onChange={(e) =>
                                  setCutlistProduction((prev) =>
                                    e.target.checked
                                      ? sortCutlistSelectionsByOrder(
                                          prev.includes(columnName) ? prev : [...prev, columnName],
                                          cutlistColumnRows,
                                        )
                                      : prev.filter((v) => v !== columnName),
                                  )
                                }
                              />
                            </label>
                            <label className="inline-flex w-[120px] shrink-0 items-center justify-center">
                              <input
                                type="checkbox"
                                checked={initialChecked}
                                onChange={(e) =>
                                  setCutlistInitial((prev) =>
                                    e.target.checked
                                      ? sortCutlistSelectionsByOrder(
                                          prev.includes(columnName) ? prev : [...prev, columnName],
                                          cutlistColumnRows,
                                        )
                                      : prev.filter((v) => v !== columnName),
                                  )
                                }
                              />
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </Panel>
                  <Panel title="Production Access">
                    <div className="grid grid-cols-[150px_1fr] gap-2 text-[12px]">
                      <p className="font-bold text-[#334155]">Unlock Key Suffix</p>
                      <input value={unlockSuffix} onChange={(e) => setUnlockSuffix(e.target.value)} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                      <p className="font-bold text-[#334155]">Unlock Duration (hours)</p>
                      <input value={unlockHours} onChange={(e) => setUnlockHours(e.target.value)} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                    </div>
                  </Panel>
                  <div className="xl:col-span-2">
                    <Panel title="Edgebanding">
                      <div className="space-y-2 text-[12px]">
                        {edgebandingRules.map((rule, idx) => (
                          <div key={`edgeband_rule_${idx}`} className="grid grid-cols-[26px_110px_110px_100px_110px] items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setEdgebandingRules((prev) => prev.filter((_, i) => i !== idx))}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                            >
                              <X size={15} strokeWidth={2.8} />
                            </button>
                            <p className="font-bold text-[#64748B]">if edgetape is</p>
                            <input
                              value={rule.upToMeters}
                              onChange={(e) => setEdgebandingRules((prev) => prev.map((v, i) => (i === idx ? { ...v, upToMeters: e.target.value } : v)))}
                              className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                            />
                            <p className="font-bold text-[#64748B]">or less, add</p>
                            <input
                              value={rule.addMeters}
                              onChange={(e) => setEdgebandingRules((prev) => prev.map((v, i) => (i === idx ? { ...v, addMeters: e.target.value } : v)))}
                              className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                            />
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setEdgebandingRules((prev) => [...prev, { upToMeters: "", addMeters: "" }])}
                          className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]"
                        >
                          + Add Rule
                        </button>
                        <div className="grid max-w-[280px] grid-cols-[130px_1fr] items-center gap-2 pt-1">
                          <p className="font-bold text-[#64748B]">Excess per end (mm)</p>
                          <input
                            value={edgebandingExcessPerEndMm}
                            onChange={(e) => setEdgebandingExcessPerEndMm(e.target.value)}
                            className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                          />
                        </div>
                        <div className="grid grid-cols-[26px_62px_90px_110px_80px_30px] items-center gap-2 pt-1">
                          <input
                            type="checkbox"
                            checked={edgebandingRoundEnabled}
                            onChange={(e) => setEdgebandingRoundEnabled(e.target.checked)}
                            className="h-4 w-4 justify-self-center"
                          />
                          <p className="font-bold text-[#64748B]">Round</p>
                          <select
                            value={edgebandingRoundDirection}
                            onChange={(e) => setEdgebandingRoundDirection(e.target.value === "down" ? "down" : "up")}
                            disabled={!edgebandingRoundEnabled}
                            className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] disabled:opacity-50"
                          >
                            <option value="up">up</option>
                            <option value="down">down</option>
                          </select>
                          <p className="font-bold text-[#64748B]">to the nearest</p>
                          <input
                            value={edgebandingRoundNearestMeters}
                            onChange={(e) => setEdgebandingRoundNearestMeters(e.target.value)}
                            disabled={!edgebandingRoundEnabled}
                            className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] disabled:opacity-50"
                          />
                          <p className="font-bold text-[#64748B]">m.</p>
                        </div>
                      </div>
                    </Panel>
                  </div>
                  <div className="xl:col-span-2">
                    <Panel title="Part Types">
                      <div className="space-y-2 text-[12px]">
                        <div className="grid grid-cols-[26px_1.2fr_90px_80px_80px_140px_110px_110px_110px] items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                          <p></p>
                          <p>Name</p>
                          <p>Color</p>
                          <p>Cabinetry</p>
                          <p>Drawer</p>
                          <p className="text-center">Autoclash</p>
                          <p>Initial Measure</p>
                          <p>Incl in Cutlists</p>
                          <p>Incl in Nesting</p>
                        </div>
                        {partTypes.map((row, idx) => (
                          <div key={`${row.name}_${idx}`} className="grid grid-cols-[26px_1.2fr_90px_80px_80px_140px_110px_110px_110px] items-center gap-2">
                            <button onClick={() => setPartTypes((prev) => prev.filter((_, i) => i !== idx))} className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"><X size={15} strokeWidth={2.8} /></button>
                            <input value={row.name} onChange={(e) => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                            <label className="relative block h-7 w-10 cursor-pointer justify-self-center overflow-hidden rounded-[8px]" title={row.color || "#7D99B3"}>
                              <span className="block h-full w-full" style={{ backgroundColor: row.color || "#7D99B3" }} />
                              <input
                                type="color"
                                value={row.color || "#7D99B3"}
                                onChange={(e) => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, color: e.target.value } : v)))}
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                              />
                            </label>
                            <label className="inline-flex items-center justify-center"><input type="checkbox" checked={row.cabinetry} onChange={() => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, cabinetry: !v.cabinetry } : v)))} /></label>
                            <label className="inline-flex items-center justify-center"><input type="checkbox" checked={row.drawer} onChange={() => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, drawer: !v.drawer } : v)))} /></label>
                            <div className="grid grid-cols-2 gap-1">
                              <select
                                value={row.autoClashLeft}
                                onChange={(e) => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, autoClashLeft: e.target.value } : v)))}
                                className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                              >
                                <option value=""></option>
                                {autoClashLeftOptions.map((opt) => (
                                  <option key={`acl_${idx}_${opt}`} value={opt}>{opt}</option>
                                ))}
                              </select>
                              <select
                                value={row.autoClashRight}
                                onChange={(e) => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, autoClashRight: e.target.value } : v)))}
                                className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                              >
                                <option value=""></option>
                                {autoClashRightOptions.map((opt) => (
                                  <option key={`acr_${idx}_${opt}`} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </div>
                            <label className="inline-flex items-center justify-center"><input type="checkbox" checked={row.initialMeasure} onChange={() => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, initialMeasure: !v.initialMeasure } : v)))} /></label>
                            <label className="inline-flex items-center justify-center"><input type="checkbox" checked={row.inCutlists} onChange={() => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, inCutlists: !v.inCutlists } : v)))} /></label>
                            <label className="inline-flex items-center justify-center"><input type="checkbox" checked={row.inNesting} onChange={() => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, inNesting: !v.inNesting } : v)))} /></label>
                          </div>
                        ))}
                        <button onClick={() => setPartTypes((prev) => [...prev, { name: "", color: "#7D99B3", cabinetry: false, drawer: false, autoClashLeft: "", autoClashRight: "", initialMeasure: false, inCutlists: true, inNesting: true }])} className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]">+ Add Part Type</button>
                      </div>
                    </Panel>
                  </div>
                </div>
              )}

              {active === "staff" && (
                <div className="grid gap-3 xl:grid-cols-[1fr_380px]">
                  <Panel
                    title="Staff"
                    headerRight={
                      canAddStaff ? (
                        <button
                          type="button"
                          onClick={() => void inviteStaffFromTopBar()}
                          disabled={isInvitingStaff || isLoading || !activeCompanyId}
                          className="h-7 rounded-[8px] border border-[#BFD4FF] bg-[#EAF1FF] px-3 text-[11px] font-bold text-[#244A9A] disabled:opacity-60"
                        >
                          {isInvitingStaff ? "Inviting..." : "Add Staff"}
                        </button>
                      ) : null
                    }
                  >
                    <div className="space-y-2 text-[12px]">
                      <div
                        className="grid gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]"
                        style={{ gridTemplateColumns: "74px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 170px 140px" }}
                      >
                        <p className="text-center">Icon</p>
                        <p>Name</p>
                        <p>Display Name</p>
                        <p>Staff Email</p>
                        <p>Mobile</p>
                        <p>Staff Role</p>
                      </div>
                      {staff.map((row) => (
                        <div
                          key={row.uid}
                          className="grid items-center gap-2"
                          style={{ gridTemplateColumns: "74px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 170px 140px" }}
                        >
                          <div className="inline-flex h-7 w-full items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-white">
                            {(() => {
                              const name = toStr(row.displayName, "CU");
                              const parts = name.split(/\s+/).filter(Boolean);
                              const initials =
                                parts.length >= 2
                                  ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase()
                                  : `${parts[0]?.[0] ?? name[0] ?? ""}`.toUpperCase();
                              const iconColor =
                                toStr(staffIconColorByUid[row.uid]) ||
                                toStr(row.badgeColor) ||
                                toStr(row.userColor) ||
                                toStr(form.themeColor) ||
                                "#7D99B3";
                              return (
                            <div
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                              style={{ backgroundColor: iconColor }}
                              title="User icon"
                            >
                              {initials || "CU"}
                            </div>
                              );
                            })()}
                          </div>
                          <input readOnly value={toStr(row.displayName)} className="h-7 min-w-0 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                          <input
                            readOnly
                            value={autoCapStaffName(toStr(row.email).split("@")[0] || toStr(row.uid))}
                            className="h-7 min-w-0 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                          />
                          <input readOnly value={toStr(row.email)} className="h-7 min-w-0 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                          <input
                            readOnly
                            value={toStr(row.mobile)}
                            className="h-7 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                          />
                          <input readOnly value={row.role} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                        </div>
                      ))}
                    </div>
                  </Panel>
                  <Panel title="Roles">
                    <div className="space-y-2 text-[12px]">
                      <div className="grid grid-cols-[1fr_110px_26px_26px_26px] gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                        <p>Role Name</p>
                        <p>Color</p>
                        <p>Up</p>
                        <p>Down</p>
                        <p>Del</p>
                      </div>
                      {roles.map((row, idx) => (
                        <div key={`${row.id}_${idx}`} className="space-y-1 rounded-[8px] border border-[#E4E7EC] p-2">
                          <div className="grid grid-cols-[1fr_110px_26px_26px_26px] gap-2">
                            <input value={row.name} onChange={(e) => setRoles((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                            <input value={row.color} onChange={(e) => setRoles((prev) => prev.map((v, i) => (i === idx ? { ...v, color: e.target.value } : v)))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                            <button onClick={() => setRoles((prev) => moveRow(prev, idx, -1))} className="rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] text-[11px] font-bold text-[#475467]">^</button>
                            <button onClick={() => setRoles((prev) => moveRow(prev, idx, 1))} className="rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] text-[11px] font-bold text-[#475467]">v</button>
                            <button onClick={() => setRoles((prev) => prev.filter((_, i) => i !== idx))} className="rounded-[8px] border border-[#F7C9CC] bg-[#FDECEC] text-[11px] font-bold text-[#B42318]">x</button>
                          </div>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-[8px] border border-[#E5E7EB] bg-white p-2">
                            {desktopPermissionKeys.map((perm) => (
                              <label key={perm} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#334155]">
                                <input type="checkbox" checked={row.permissions.includes(perm)} onChange={() => toggleRolePermission(idx, perm)} />
                                <span>{perm}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                      <button onClick={() => setRoles((prev) => [...prev, { id: `role_${prev.length + 1}`, name: "", color: "#7D99B3", permissions: [] }])} className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]">+ Add Role</button>
                    </div>
                  </Panel>
                </div>
              )}

              {active === "dashboard" && (
                <div className="w-[20vw] space-y-3">
                  <Panel title="Completed Project Legend">
                    <div className="space-y-2 text-[12px]">
                      <div className="grid grid-cols-[26px_26px_1fr_46px] items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                        <p></p>
                        <p></p>
                        <p>Name</p>
                        <p>Color</p>
                      </div>
                      {dashboardLegend.map((row, idx) => (
                        <div
                          key={`${row.id}_${idx}`}
                          className={`grid grid-cols-[26px_26px_1fr_46px] items-center gap-2 rounded-[8px] transition-all ${
                            legendDragIndex === idx
                              ? "z-10 bg-white opacity-80 shadow-[0_8px_24px_rgba(15,23,42,0.18)]"
                              : legendDragOverIndex === idx
                                ? "bg-white"
                                : ""
                          }`}
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
                            triggerAutosaveAfterRowDrop();
                          }}
                        >
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setLegendDragIndex(idx);
                              setLegendDragOverIndex(idx);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", `${row.id}`);
                            }}
                            onDragEnd={() => {
                              setLegendDragIndex(null);
                              setLegendDragOverIndex(null);
                            }}
                            className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] text-[#475467] active:cursor-grabbing"
                            title="Drag to reorder"
                          >
                            <GripVertical size={14} />
                          </button>
                          <button
                            onClick={() => setDashboardLegend((prev) => prev.filter((_, i) => i !== idx))}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                            title="Delete row"
                          >
                            <X size={15} strokeWidth={2.8} />
                          </button>
                          <input value={row.name} onChange={(e) => setDashboardLegend((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                          <label className="relative block h-7 w-10 cursor-pointer justify-self-center overflow-hidden rounded-[8px]" title={row.color || "#2A7A3B"}>
                            <span className="block h-full w-full" style={{ backgroundColor: row.color || "#2A7A3B" }} />
                            <input
                              type="color"
                              value={row.color || "#2A7A3B"}
                              onChange={(e) => setDashboardLegend((prev) => prev.map((v, i) => (i === idx ? { ...v, color: e.target.value } : v)))}
                              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            />
                          </label>
                        </div>
                      ))}
                      <button onClick={() => setDashboardLegend((prev) => [...prev, { id: `legend_${prev.length + 1}`, name: "", color: form.themeColor || "#2A7A3B" }])} className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]">+ Add</button>
                    </div>
                  </Panel>
                  <Panel title="Project Statuses">
                    <div className="space-y-2 text-[12px]">
                      <div className="grid grid-cols-[26px_26px_1fr_46px] items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                        <p></p>
                        <p>Del</p>
                        <p>Status Name</p>
                        <p className="text-center">Color</p>
                      </div>
                      {statuses.map((row, idx) => (
                        <div
                          key={`${row.name}_${idx}`}
                          className={`grid grid-cols-[26px_26px_1fr_46px] items-center gap-2 rounded-[8px] transition-all ${
                            statusDragIndex === idx
                              ? "z-10 bg-white opacity-80 shadow-[0_8px_24px_rgba(15,23,42,0.18)]"
                              : statusDragOverIndex === idx
                                ? "bg-white"
                                : ""
                          }`}
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
                            triggerAutosaveAfterRowDrop();
                          }}
                        >
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setStatusDragIndex(idx);
                              setStatusDragOverIndex(idx);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", `${idx}`);
                            }}
                            onDragEnd={() => {
                              setStatusDragIndex(null);
                              setStatusDragOverIndex(null);
                            }}
                            className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] text-[#475467] active:cursor-grabbing"
                            title="Drag to reorder"
                          >
                            <GripVertical size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setStatuses((prev) => prev.filter((_, i) => i !== idx))}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                          >
                            <X size={15} strokeWidth={2.8} />
                          </button>
                          <input
                            value={row.name}
                            onChange={(e) => setStatuses((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))}
                            className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                          />
                          <label className="relative block h-7 w-10 cursor-pointer justify-self-center overflow-hidden rounded-[8px]" title={row.color || "#64748B"}>
                            <span className="block h-full w-full" style={{ backgroundColor: row.color || "#64748B" }} />
                            <input
                              type="color"
                              value={row.color || "#64748B"}
                              onChange={(e) => setStatuses((prev) => prev.map((v, i) => (i === idx ? { ...v, color: e.target.value } : v)))}
                              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            />
                          </label>
                        </div>
                      ))}
                      <button
                        onClick={() => setStatuses((prev) => [...prev, { name: "", color: "#64748B" }])}
                        className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]"
                      >
                        + Add
                      </button>
                    </div>
                  </Panel>
                  <Panel title="Tags">
                    <div className="space-y-2 text-[12px]">
                      <div className="grid grid-cols-[26px_1fr_60px] items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                        <p></p>
                        <p>Tag</p>
                        <p className="text-center">Count</p>
                      </div>
                      {projectTagUsage.map((row, idx) => (
                        <div key={`tag_row_${idx}`} className="grid grid-cols-[26px_1fr_60px] items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setProjectTagUsage((prev) => prev.filter((_, i) => i !== idx))}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                          >
                            <X size={15} strokeWidth={2.8} />
                          </button>
                          <input value={row.value} onChange={(e) => setProjectTagUsage((prev) => prev.map((v, i) => (i === idx ? { ...v, value: e.target.value } : v)))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                          <div className="inline-flex h-7 w-full items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-center text-[12px] font-semibold text-[#334155]">
                            {String(row.count || "0")}
                          </div>
                        </div>
                      ))}
                      <button onClick={() => setProjectTagUsage((prev) => [...prev, { value: "", count: "0" }])} className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]">+ Add Tag</button>
                    </div>
                  </Panel>
                </div>
              )}

              {active === "sales" && (
                <div className="space-y-3">
                  <Panel title="Item Categories">
                    <div className="space-y-2 text-[12px]">
                      <div className="grid grid-cols-[26px_26px_26px_72px_1fr_1fr] gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                        <p></p>
                        <p></p>
                        <p></p>
                        <p className="text-center">COLOUR</p>
                        <p>Name</p>
                        <p>Sub-categories</p>
                      </div>
                      {itemCategories.map((row, idx) => (
                        <div key={idx} className="space-y-2">
                          <div
                            className={`grid grid-cols-[26px_26px_26px_72px_1fr_1fr] gap-2 rounded-[8px] transition-all ${
                              itemCategoryDragIndex === idx
                                ? "bg-white opacity-80 shadow-[0_8px_24px_rgba(15,23,42,0.18)]"
                                : itemCategoryDragOverIndex === idx
                                  ? "bg-white"
                                  : ""
                            }`}
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
                              triggerAutosaveAfterRowDrop();
                            }}
                          >
                            <button
                              type="button"
                              draggable
                              onDragStart={(e) => {
                                setItemCategoryDragIndex(idx);
                                setItemCategoryDragOverIndex(idx);
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", `itemcat_${idx}`);
                              }}
                              onDragEnd={() => {
                                setItemCategoryDragIndex(null);
                                setItemCategoryDragOverIndex(null);
                              }}
                              className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] text-[#475467] active:cursor-grabbing"
                              title="Drag to reorder"
                            >
                              <GripVertical size={14} />
                            </button>
                            <button onClick={() => setItemCategories((prev) => prev.filter((_, i) => i !== idx))} className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"><X size={15} strokeWidth={2.8} /></button>
                            <button
                              type="button"
                              onClick={() => toggleItemCategoryExpanded(idx)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7]"
                              title={itemCategoryExpanded[idx] ? "Collapse" : "Expand"}
                            >
                              <img
                                src="/Arrow.png"
                                alt="Expand"
                                className={`h-3 w-3 transition-transform ${itemCategoryExpanded[idx] ? "[transform:rotate(90deg)_scaleX(-1)]" : "[transform:rotate(270deg)_scaleX(-1)]"}`}
                              />
                            </button>
                            <label className="relative block h-7 w-10 cursor-pointer justify-self-center overflow-hidden rounded-[8px]" title={row.color || "#7D99B3"}>
                              <span className="block h-full w-full" style={{ backgroundColor: row.color || "#7D99B3" }} />
                              <input
                                type="color"
                                value={row.color || "#7D99B3"}
                                onChange={(e) => setItemCategories((prev) => prev.map((v, i) => (i === idx ? { ...v, color: e.target.value } : v)))}
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                              />
                            </label>
                            <input value={row.name} onChange={(e) => setItemCategories((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                            <div className="flex h-7 flex-wrap items-center gap-1 px-1">
                              <button
                                type="button"
                                onClick={() => addItemCategorySubcategory(idx)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#A9DDBF] bg-[#EAF8F0] text-[#1F8A4C] hover:bg-[#DDF2E7]"
                                title="Add sub-category"
                              >
                                <Plus size={13} className="mx-auto" strokeWidth={2.8} />
                              </button>
                              {parseSubcategoryNames(row.subcategories).map((sub) => (
                                <span key={`${idx}_${sub}`} className="inline-flex h-7 items-center gap-1 rounded-[999px] border border-[#D8DEE8] bg-white px-2 text-[11px] text-[#334155]">
                                  {sub}
                                  <button
                                    type="button"
                                    onClick={() => removeItemCategorySubcategory(idx, sub)}
                                    className="inline-flex h-4 w-4 items-center justify-center rounded-[6px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                                    title="Remove sub-category"
                                  >
                                    <X size={11} strokeWidth={2.8} />
                                  </button>
                                </span>
                              ))}
                            </div>
                          </div>

                          {itemCategoryExpanded[idx] && (
                            <div
                              className="rounded-[10px] border p-2"
                              style={{ backgroundColor: tintHex(row.color, 0.82), borderColor: row.color || "#7D99B3" }}
                            >
                              <div className="mb-2 grid grid-cols-[30px_1fr_220px_140px_140px_150px] items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                                <p></p>
                                <p>Name</p>
                                <p>Sub Category</p>
                                <p>Price</p>
                                <p>Markup %</p>
                                <p>Output Price</p>
                              </div>
                              <div className="space-y-2">
                                {(row.items ?? []).map((itemRow, itemIdx) => {
                                  const subcategoryOptions = parseSubcategoryNames(row.subcategories);
                                  return (
                                    <div key={`${idx}_item_${itemIdx}`} className="grid grid-cols-[30px_1fr_220px_140px_140px_150px] items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => removeItemCategoryItem(idx, itemIdx)}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                                        title="Delete item"
                                      >
                                        <X size={15} strokeWidth={2.8} />
                                      </button>
                                      <input
                                        value={itemRow.name}
                                        onChange={(e) => updateItemCategoryItem(idx, itemIdx, { name: e.target.value })}
                                        className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                      />
                                      <select
                                        value={itemRow.subcategory}
                                        onChange={(e) => updateItemCategoryItem(idx, itemIdx, { subcategory: e.target.value })}
                                        className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                      >
                                        <option value=""></option>
                                        {subcategoryOptions.map((sub) => (
                                          <option key={`${idx}_sub_opt_${sub}`} value={sub}>{sub}</option>
                                        ))}
                                      </select>
                                      <input
                                        value={itemRow.price}
                                        onChange={(e) => updateItemCategoryItem(idx, itemIdx, { price: e.target.value })}
                                        onBlur={(e) => updateItemCategoryItem(idx, itemIdx, { price: ensureDollarFormat(e.target.value) })}
                                        className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                        placeholder="$0.00"
                                      />
                                      <input
                                        value={itemRow.markupPercent}
                                        onChange={(e) => updateItemCategoryItem(idx, itemIdx, { markupPercent: e.target.value })}
                                        className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                        placeholder="0"
                                      />
                                      <div className="inline-flex h-7 items-center rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] font-semibold text-[#334155]">
                                        {computeOutputPrice(itemRow.price, itemRow.markupPercent)}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <button
                                type="button"
                                onClick={() => addItemCategoryItem(idx)}
                                className="mt-2 inline-flex h-7 items-center gap-1 rounded-[8px] border border-[#A9DDBF] bg-[#EAF8F0] px-3 text-[11px] font-bold text-[#1F8A4C] hover:bg-[#DDF2E7]"
                              >
                                <Plus size={13} strokeWidth={2.8} />
                                Add Item
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      <button onClick={() => setItemCategories((prev) => [...prev, { name: "", color: "#7D99B3", subcategories: "", items: [] }])} className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]">+ Add Category</button>
                    </div>
                  </Panel>
                  <Panel title="Product">
                    <div className="space-y-2 text-[12px]">
                      <div className="grid grid-cols-[26px_26px_26px_1fr_120px_70px_90px] items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                        <p></p>
                        <p></p>
                        <p></p>
                        <p>Name</p>
                        <p className="text-center">Sheet Sizes</p>
                        <p className="text-center">Grain</p>
                        <p className="text-center">INCL IN SALES</p>
                      </div>
                      {jobTypes.map((row, idx) => (
                        <div key={idx} className="space-y-2">
                          <div
                            className={`grid grid-cols-[26px_26px_26px_1fr_120px_70px_90px] items-center gap-2 rounded-[8px] transition-all ${
                              jobTypeDragIndex === idx
                                ? "bg-white opacity-80 shadow-[0_8px_24px_rgba(15,23,42,0.18)]"
                              : jobTypeDragOverIndex === idx
                                  ? "bg-white"
                                  : ""
                            }`}
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
                              triggerAutosaveAfterRowDrop();
                            }}
                          >
                            <button
                              type="button"
                              draggable
                              onDragStart={(e) => {
                                setJobTypeDragIndex(idx);
                                setJobTypeDragOverIndex(idx);
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", `jobtype_${idx}`);
                              }}
                              onDragEnd={() => {
                                setJobTypeDragIndex(null);
                                setJobTypeDragOverIndex(null);
                              }}
                              className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] text-[#475467] active:cursor-grabbing"
                              title="Drag to reorder"
                            >
                              <GripVertical size={14} />
                            </button>
                            <button onClick={() => setJobTypes((prev) => prev.filter((_, i) => i !== idx))} className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"><X size={15} strokeWidth={2.8} /></button>
                            <button
                              type="button"
                              onClick={() => toggleJobTypeExpanded(idx)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7]"
                              title={jobTypeExpanded[idx] ? "Collapse" : "Expand"}
                            >
                              <img
                                src="/Arrow.png"
                                alt="Expand"
                                className={`h-3 w-3 transition-transform ${jobTypeExpanded[idx] ? "[transform:rotate(90deg)_scaleX(-1)]" : "[transform:rotate(270deg)_scaleX(-1)]"}`}
                              />
                            </button>
                            <input value={row.name} onChange={(e) => setJobTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                            <div className="inline-flex h-7 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[11px] font-semibold text-[#475467]">
                              {row.sheetPrices?.length || 0} options
                            </div>
                            <label className="inline-flex items-center justify-center text-[11px] font-bold text-[#475467]">
                              <input
                                type="checkbox"
                                checked={Boolean(row.grain)}
                                onChange={() => setJobTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, grain: !v.grain } : v)))}
                              />
                            </label>
                            <label className="inline-flex items-center justify-center text-[11px] font-bold text-[#475467]"><input type="checkbox" checked={row.showInSales} onChange={() => setJobTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, showInSales: !v.showInSales } : v)))} /></label>
                          </div>

                          {jobTypeExpanded[idx] && (
                            <div className="rounded-[10px] border border-[#D8DEE8] bg-white p-2">
                              <div className="mb-2 grid grid-cols-[30px_220px_140px] items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                                <p></p>
                                <p>Sheet Size</p>
                                <p>Price/Sheet</p>
                              </div>
                              <div className="space-y-2">
                                {(row.sheetPrices ?? []).map((sp, spIdx) => (
                                  <div key={`${idx}_sheetprice_${spIdx}`} className="grid grid-cols-[30px_220px_140px] items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => removeJobTypeSheetPrice(idx, spIdx)}
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                                      title="Delete sheet size option"
                                    >
                                      <X size={15} strokeWidth={2.8} />
                                    </button>
                                    <select
                                      value={sp.sheetSize}
                                      onChange={(e) => updateJobTypeSheetPrice(idx, spIdx, { sheetSize: e.target.value })}
                                      className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                    >
                                      <option value=""></option>
                                      {sheetSizes.map((ss, sIdx) => {
                                        const label = `${ss.h} x ${ss.w}`;
                                        return <option key={`${idx}_sheetsize_opt_${sIdx}_${label}`} value={label}>{label}</option>;
                                      })}
                                    </select>
                                    <input
                                      value={sp.pricePerSheet}
                                      onChange={(e) => updateJobTypeSheetPrice(idx, spIdx, { pricePerSheet: e.target.value })}
                                      onBlur={(e) => updateJobTypeSheetPrice(idx, spIdx, { pricePerSheet: ensureDollarFormat(e.target.value) })}
                                      className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                      placeholder="$0.00"
                                    />
                                  </div>
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => addJobTypeSheetPrice(idx)}
                                className="mt-2 inline-flex h-7 items-center gap-1 rounded-[8px] border border-[#A9DDBF] bg-[#EAF8F0] px-3 text-[11px] font-bold text-[#1F8A4C] hover:bg-[#DDF2E7]"
                              >
                                <Plus size={13} strokeWidth={2.8} />
                                Add Sheet Size
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      <button onClick={() => setJobTypes((prev) => [...prev, { name: "", sheetPrices: [], showInSales: true, grain: false }])} className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]">+ Add Product</button>
                    </div>
                  </Panel>
                  <div className="grid gap-3 xl:grid-cols-[3fr_1fr]">
                    <div className="space-y-3">
                      <Panel title="Quote Extras">
                        <div className="space-y-2 text-[12px]">
                          <div className="grid grid-cols-[26px_26px_1fr_90px_70px_1fr_1fr_1fr] items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                            <p>Del</p>
                            <p></p>
                            <p>Name</p>
                            <p>Price</p>
                            <p>Default</p>
                            <p>Container</p>
                            <p>Element</p>
                            <p>Placeholder</p>
                          </div>
                          {quoteExtras.map((row, idx) => (
                            <div
                              key={row.id || idx}
                              className={`grid grid-cols-[26px_26px_1fr_90px_70px_1fr_1fr_1fr] items-center gap-2 rounded-[8px] transition-all ${
                                quoteExtraDragIndex === idx
                                  ? "bg-white opacity-80 shadow-[0_8px_24px_rgba(15,23,42,0.18)]"
                                  : quoteExtraDragOverIndex === idx
                                    ? "bg-white"
                                    : ""
                              }`}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                              }}
                              onDragEnter={(e) => {
                                e.preventDefault();
                                if (quoteExtraDragIndex == null || quoteExtraDragIndex === idx) return;
                                setQuoteExtras((prev) => moveRowTo(prev, quoteExtraDragIndex, idx));
                                setQuoteExtraDragIndex(idx);
                                setQuoteExtraDragOverIndex(idx);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                setQuoteExtraDragIndex(null);
                                setQuoteExtraDragOverIndex(null);
                                triggerAutosaveAfterRowDrop();
                              }}
                            >
                              <button onClick={() => setQuoteExtras((prev) => prev.filter((_, i) => i !== idx))} className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"><X size={15} strokeWidth={2.8} /></button>
                              <button
                                type="button"
                                draggable
                                onDragStart={(e) => {
                                  setQuoteExtraDragIndex(idx);
                                  setQuoteExtraDragOverIndex(idx);
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", `quoteextra_${idx}`);
                                }}
                                onDragEnd={() => {
                                  setQuoteExtraDragIndex(null);
                                  setQuoteExtraDragOverIndex(null);
                                }}
                                className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] text-[#475467] active:cursor-grabbing"
                                title="Drag to reorder"
                              >
                                <GripVertical size={14} />
                              </button>
                              <input value={row.name} onChange={(e) => setQuoteExtras((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                              <input value={row.price} onChange={(e) => setQuoteExtras((prev) => prev.map((v, i) => (i === idx ? { ...v, price: e.target.value } : v)))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                              <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#475467]"><input type="checkbox" checked={row.defaultIncluded} onChange={() => setQuoteExtras((prev) => prev.map((v, i) => (i === idx ? { ...v, defaultIncluded: !v.defaultIncluded } : v)))} />Default</label>
                              <select
                                value={row.templateContainerId}
                                onChange={(e) =>
                                  setQuoteExtras((prev) =>
                                    prev.map((v, i) =>
                                      i === idx
                                        ? {
                                            ...v,
                                            templateContainerId: e.target.value,
                                            templateBlockId: e.target.value ? "" : v.templateBlockId,
                                            templatePlaceholderKey: e.target.value ? "" : v.templatePlaceholderKey,
                                          }
                                        : v,
                                    ),
                                  )
                                }
                                disabled={Boolean(row.templateBlockId || row.templatePlaceholderKey)}
                                className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] disabled:bg-[#F8FAFC] disabled:text-[#98A2B3]"
                              >
                                <option value=""></option>
                                {quoteTemplateContainerOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.title}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={row.templateBlockId}
                                onChange={(e) =>
                                  setQuoteExtras((prev) =>
                                    prev.map((v, i) =>
                                      i === idx
                                        ? {
                                            ...v,
                                            templateBlockId: e.target.value,
                                            templateContainerId: e.target.value ? "" : v.templateContainerId,
                                            templatePlaceholderKey: e.target.value ? "" : v.templatePlaceholderKey,
                                          }
                                        : v,
                                    ),
                                  )
                                }
                                disabled={Boolean(row.templateContainerId || row.templatePlaceholderKey)}
                                className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] disabled:bg-[#F8FAFC] disabled:text-[#98A2B3]"
                              >
                                <option value=""></option>
                                {quoteTemplateBlockOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={row.templatePlaceholderKey}
                                onChange={(e) =>
                                  setQuoteExtras((prev) =>
                                    prev.map((v, i) =>
                                      i === idx
                                        ? {
                                            ...v,
                                            templatePlaceholderKey: e.target.value,
                                            templateContainerId: e.target.value ? "" : v.templateContainerId,
                                            templateBlockId: e.target.value ? "" : v.templateBlockId,
                                          }
                                        : v,
                                    ),
                                  )
                                }
                                disabled={Boolean(row.templateContainerId || row.templateBlockId)}
                                className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] disabled:bg-[#F8FAFC] disabled:text-[#98A2B3]"
                              >
                                <option value=""></option>
                                {quoteTemplatePlaceholderOptions.map((option) => (
                                  <option key={option.key} value={option.key}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                          <button
                            onClick={() =>
                              setQuoteExtras((prev) => [
                                ...prev,
                                {
                                  id: `quote_extra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                                  name: "",
                                  price: "",
                                  defaultIncluded: false,
                                  templateContainerId: "",
                                  templateBlockId: "",
                                  templatePlaceholderKey: "",
                                },
                              ])
                            }
                            className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]"
                          >
                            + Add Extra
                          </button>
                        </div>
                      </Panel>
                      <Panel title="Quote Helpers">
                        <div className="space-y-3">
                          <p className="text-[12px] text-[#667085]">
                            Add reusable helper snippets here. They will appear in the live quote sidebar under Quote Extras and insert at the current cursor position in the project text field.
                          </p>
                          {quoteHelpers.map((row, idx) => (
                            <div
                              key={row.id || idx}
                              className={`rounded-[12px] border border-[#D8DEE8] bg-white p-3 transition-all ${
                                quoteHelperDragIndex === idx
                                  ? "opacity-80 shadow-[0_8px_24px_rgba(15,23,42,0.18)]"
                                  : quoteHelperDragOverIndex === idx
                                    ? "shadow-[0_4px_14px_rgba(15,23,42,0.08)]"
                                    : ""
                              }`}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                              }}
                              onDragEnter={(e) => {
                                e.preventDefault();
                                if (quoteHelperDragIndex == null || quoteHelperDragIndex === idx) return;
                                setQuoteHelpers((prev) => moveRowTo(prev, quoteHelperDragIndex, idx));
                                setQuoteHelperDragIndex(idx);
                                setQuoteHelperDragOverIndex(idx);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                setQuoteHelperDragIndex(null);
                                setQuoteHelperDragOverIndex(null);
                                triggerAutosaveAfterRowDrop();
                              }}
                            >
                              <div className="grid grid-cols-[28px_auto_minmax(0,1fr)] items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setQuoteHelpers((prev) => prev.filter((_, helperIdx) => helperIdx !== idx))}
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                                  title="Delete helper"
                                >
                                  <X size={15} strokeWidth={2.8} />
                                </button>
                                <div className="flex items-center gap-1 whitespace-nowrap">
                                  <button
                                    type="button"
                                    draggable
                                    onDragStart={(e) => {
                                      setQuoteHelperDragIndex(idx);
                                      setQuoteHelperDragOverIndex(idx);
                                      e.dataTransfer.effectAllowed = "move";
                                      e.dataTransfer.setData("text/plain", `quotehelper_${idx}`);
                                    }}
                                    onDragEnd={() => {
                                      setQuoteHelperDragIndex(null);
                                      setQuoteHelperDragOverIndex(null);
                                    }}
                                    className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] text-[#475467] active:cursor-grabbing"
                                    title="Drag to reorder"
                                  >
                                    <GripVertical size={14} />
                                  </button>
                                  {[
                                    { command: "bold" as const, label: "B" },
                                    { command: "italic" as const, label: "I" },
                                    { command: "underline" as const, label: "U" },
                                    { command: "strikeThrough" as const, label: "S" },
                                  ].map((item) => (
                                    <button
                                      key={`${row.id}_${item.command}`}
                                      type="button"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        applyQuoteRichTextCommand(
                                          quoteHelperRefs.current[row.id] ?? null,
                                          item.command,
                                          (nextValue) =>
                                            setQuoteHelpers((prev) =>
                                              prev.map((helper, helperIdx) =>
                                                helperIdx === idx ? { ...helper, content: nextValue } : helper,
                                              ),
                                            ),
                                        );
                                      }}
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#F8FAFD] text-[11px] font-bold text-[#344054]"
                                    >
                                      {item.label}
                                    </button>
                                  ))}
                                </div>
                                <div
                                  ref={(node) => {
                                    quoteHelperRefs.current[row.id] = node;
                                    if (node) {
                                      const nextHtml = renderQuoteRichTextHtml(row.content);
                                      if (document.activeElement !== node && node.innerHTML !== nextHtml) {
                                        node.innerHTML = nextHtml;
                                      }
                                    }
                                  }}
                                  contentEditable
                                  suppressContentEditableWarning
                                  onInput={(e) => {
                                    const nextValue = sanitizeQuoteRichTextMarkup(e.currentTarget.innerHTML);
                                    setQuoteHelpers((prev) =>
                                      prev.map((helper, helperIdx) =>
                                        helperIdx === idx ? { ...helper, content: nextValue } : helper,
                                      ),
                                    );
                                  }}
                                  className="block min-h-[28px] min-w-0 overflow-hidden rounded-[10px] border border-[#D8DEE8] bg-white px-3 py-1.5 text-[12px] leading-[1.5] outline-none empty:before:text-[#98A2B3] empty:before:content-['Type_helper_text_here...']"
                                />
                              </div>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setQuoteHelpers((prev) => [
                                ...prev,
                                {
                                  id: `quote_helper_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                                  content: "",
                                },
                              ])
                            }
                            className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]"
                          >
                            + Add Helper
                          </button>
                        </div>
                      </Panel>
                    </div>
                    <Panel title="Quote Discount">
                      <div className="space-y-2 text-[12px]">
                        <label className="inline-flex items-center gap-2 font-bold text-[#334155]"><input type="checkbox" checked={minusOffQuoteTotal} onChange={() => setMinusOffQuoteTotal((v) => !v)} />minus off quote total</label>
                        <div className="grid grid-cols-[26px_26px_1fr_1fr_1fr] items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                          <p></p>
                          <p></p>
                          <p className="text-center">Low</p>
                          <p className="text-center">High</p>
                          <p className="text-center">Discount</p>
                        </div>
                        {discountTiers.map((row, idx) => (
                          <div
                            key={idx}
                            className={`grid grid-cols-[26px_26px_1fr_1fr_1fr] items-center gap-2 rounded-[8px] transition-all ${
                              discountTierDragIndex === idx
                                ? "bg-white opacity-80 shadow-[0_8px_24px_rgba(15,23,42,0.18)]"
                                : discountTierDragOverIndex === idx
                                  ? "bg-white"
                                  : ""
                            }`}
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
                              triggerAutosaveAfterRowDrop();
                            }}
                          >
                            <button
                              type="button"
                              draggable
                              onDragStart={(e) => {
                                setDiscountTierDragIndex(idx);
                                setDiscountTierDragOverIndex(idx);
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", `discount_${idx}`);
                              }}
                              onDragEnd={() => {
                                setDiscountTierDragIndex(null);
                                setDiscountTierDragOverIndex(null);
                              }}
                              className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] text-[#475467] active:cursor-grabbing"
                              title="Drag to reorder"
                            >
                              <GripVertical size={14} />
                            </button>
                            <button onClick={() => setDiscountTiers((prev) => prev.filter((_, i) => i !== idx))} className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"><X size={15} strokeWidth={2.8} /></button>
                            <input
                              value={row.low}
                              onChange={(e) => setDiscountTiers((prev) => prev.map((v, i) => (i === idx ? { ...v, low: e.target.value } : v)))}
                              onBlur={(e) => setDiscountTiers((prev) => prev.map((v, i) => (i === idx ? { ...v, low: formatDiscountCurrency(e.target.value) } : v)))}
                              className="h-7 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                            />
                            <input
                              value={row.high}
                              onChange={(e) => setDiscountTiers((prev) => prev.map((v, i) => (i === idx ? { ...v, high: e.target.value } : v)))}
                              onBlur={(e) => setDiscountTiers((prev) => prev.map((v, i) => (i === idx ? { ...v, high: formatDiscountCurrency(e.target.value) } : v)))}
                              className="h-7 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                            />
                            <input
                              value={row.discount}
                              onChange={(e) => setDiscountTiers((prev) => prev.map((v, i) => (i === idx ? { ...v, discount: e.target.value } : v)))}
                              onBlur={(e) => setDiscountTiers((prev) => prev.map((v, i) => (i === idx ? { ...v, discount: formatDiscountCurrency(e.target.value) } : v)))}
                              className="h-7 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                            />
                          </div>
                        ))}
                        <button onClick={() => setDiscountTiers((prev) => [...prev, { low: "", high: "", discount: "" }])} className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]">+ Add Tier</button>
                      </div>
                    </Panel>
                  </div>
                </div>
              )}

              {active === "hardware" && (
                <Panel title="Hardware">
                  <div className="space-y-2 text-[12px]">
                    <div className="grid grid-cols-[28px_28px_28px_1fr_110px_90px] items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                      <p></p>
                      <p></p>
                      <p></p>
                      <p>Hardware Name</p>
                      <p>Color</p>
                      <p>Default</p>
                    </div>
                    {hardware.map((row, idx) => (
                      <div
                        key={idx}
                        className={`space-y-2 transition-all ${
                          hardwareDragOverIndex === idx
                            ? "rounded-[8px] bg-[#EEF4FF] ring-1 ring-[#AFC6E9] shadow-[0_4px_14px_rgba(47,107,255,0.15)]"
                            : ""
                        }`}
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
                          triggerAutosaveAfterRowDrop();
                        }}
                      >
                        <div
                          className="grid grid-cols-[28px_28px_28px_1fr_110px_90px] items-center gap-2 rounded-[8px] px-1 py-1"
                          style={{ backgroundColor: row.color || "#7D99B3", color: textColorForHex(row.color || "#7D99B3") }}
                        >
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            setHardwareDragIndex(idx);
                            setHardwareDragOverIndex(idx);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", `hardware_${idx}`);
                          }}
                          onDragEnd={() => {
                            setHardwareDragIndex(null);
                            setHardwareDragOverIndex(null);
                          }}
                          className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-[8px] border active:cursor-grabbing"
                          style={{
                            backgroundColor: tintHex(row.color || "#7D99B3", 0.6),
                            borderColor: tintHex(row.color || "#7D99B3", 0.45),
                            color: textColorForHex(tintHex(row.color || "#7D99B3", 0.6)),
                          }}
                          title="Drag to reorder"
                        >
                          <GripVertical size={14} />
                        </button>
                        <button onClick={() => setHardware((prev) => sanitizeHardwareRows(prev.filter((_, i) => i !== idx)))} className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"><X size={15} strokeWidth={2.8} /></button>
                        <button
                          type="button"
                          onClick={() => toggleHardwareExpanded(idx)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border"
                          style={{
                            backgroundColor: tintHex(row.color || "#7D99B3", 0.6),
                            borderColor: tintHex(row.color || "#7D99B3", 0.45),
                          }}
                          title={(hardwareExpanded[idx] ?? false) ? "Collapse" : "Expand"}
                        >
                          <img
                            src="/Arrow.png"
                            alt="Expand"
                            className={`h-3 w-3 transition-transform ${(hardwareExpanded[idx] ?? false) ? "[transform:rotate(90deg)_scaleX(-1)]" : "[transform:rotate(270deg)_scaleX(-1)]"}`}
                          />
                        </button>
                        <input
                          value={row.name}
                          onChange={(e) => setHardware((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))}
                          className="h-7 rounded-[8px] border px-2 text-[12px]"
                          style={{
                            backgroundColor: tintHex(row.color || "#7D99B3", 0.72),
                            borderColor: tintHex(row.color || "#7D99B3", 0.45),
                            color: textColorForHex(tintHex(row.color || "#7D99B3", 0.72)),
                          }}
                        />
                        <label
                          className="relative block h-7 w-10 cursor-pointer justify-self-center overflow-hidden rounded-[8px] border"
                          style={{ borderColor: tintHex(row.color || "#7D99B3", 0.38) }}
                          title={row.color || "#7D99B3"}
                        >
                          <span className="block h-full w-full" style={{ backgroundColor: row.color || "#7D99B3" }} />
                          <input
                            type="color"
                            value={row.color || "#7D99B3"}
                            onChange={(e) => setHardware((prev) => prev.map((v, i) => (i === idx ? { ...v, color: e.target.value } : v)))}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                          />
                        </label>
                        {hardware.some((h) => h.default) ? (
                          row.default ? (
                            <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#475467]">
                              <input
                                type="checkbox"
                                checked
                                onChange={(e) => {
                                  if (!e.target.checked) {
                                    setHardware((prev) => sanitizeHardwareRows(prev.map((v, i) => (i === idx ? { ...v, default: false } : v))));
                                  }
                                }}
                              />
                              Default
                            </label>
                          ) : (
                            <span className="inline-block h-7" />
                          )
                        ) : (
                          <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#475467]">
                            <input
                              type="checkbox"
                              checked={Boolean(row.default)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setHardware((prev) => sanitizeHardwareRows(prev.map((v, i) => ({ ...v, default: i === idx }))));
                                }
                              }}
                            />
                            Default
                          </label>
                        )}
                        </div>
                        {(hardwareExpanded[idx] ?? false) && (
                          <div
                            className="space-y-2 rounded-[8px] border p-2"
                            style={{ backgroundColor: tintHex(row.color || "#7D99B3", 0.82), borderColor: row.color || "#7D99B3" }}
                          >
                            <div className="inline-flex rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFC] p-1">
                              {(["drawers", "hinges", "other"] as const).map((tab) => {
                                const selected = (hardwareActiveTab[idx] ?? "drawers") === tab;
                                return (
                                  <button
                                    key={tab}
                                    type="button"
                                    onClick={() => setHardwareActiveTab((prev) => ({ ...prev, [idx]: tab }))}
                                    className="h-7 rounded-[8px] px-3 text-[11px] font-extrabold uppercase tracking-[0.5px]"
                                    style={{
                                      backgroundColor: selected ? (row.color || "#7D99B3") : tintHex(row.color || "#7D99B3", 0.5),
                                      color: textColorForHex(selected ? (row.color || "#7D99B3") : tintHex(row.color || "#7D99B3", 0.5)),
                                      border: `1px solid ${tintHex(row.color || "#7D99B3", 0.35)}`,
                                    }}
                                  >
                                    {tab}
                                  </button>
                                );
                              })}
                            </div>
                            {(hardwareActiveTab[idx] ?? "drawers") === "drawers" && (
                              <div
                                className="space-y-2 rounded-[8px] border p-2"
                                style={{ backgroundColor: tintHex(row.color || "#7D99B3", 0.82), borderColor: row.color || "#7D99B3" }}
                              >
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] font-extrabold uppercase tracking-[0.6px] text-[#1E3A62]">Drawers</p>
                            <button
                              onClick={() =>
                                updateHardwareJsonList(idx, "drawersJson", (items) => [
                                  ...items,
                                  { name: "", bottoms: { widthMinus: "", depthMinus: "" }, backs: { widthMinus: "" }, hardwareLengths: [], spaceRequirement: "", default: items.length === 0 },
                                ])
                              }
                              className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]"
                            >
                              + Add Drawer
                            </button>
                          </div>
                          <div className="space-y-2">
                            <div className="grid grid-cols-[26px_26px_26px_1fr_84px] items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#667085]">
                              <p></p>
                              <p></p>
                              <p></p>
                              <p>Name</p>
                              <p>Default</p>
                            </div>
                            {(() => {
                              const drawerRows = parseJsonObjects(row.drawersJson);
                              const hasDrawerDefault = drawerRows.some((d) => Boolean(d.default));
                              return drawerRows.map((drawer, drawerIdx) => {
                                const drawerKey = `${idx}:${drawerIdx}`;
                                const isExpanded = drawerRowExpanded[drawerKey] ?? false;
                                return (
                                  <div
                                    key={drawerIdx}
                                    className={`space-y-2 rounded-[8px] border p-2 ${
                                      drawerDragHardwareIndex === idx && drawerDragOverIndex === drawerIdx
                                        ? "border-[#AFC6E9] bg-[#EEF4FF]"
                                        : "border-[#E4E7EC] bg-white"
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
                                      triggerAutosaveAfterRowDrop();
                                    }}
                                  >
                                    <div className="grid grid-cols-[26px_26px_26px_1fr_84px] items-center gap-2">
                                      <button
                                        type="button"
                                        draggable
                                        onDragStart={(e) => {
                                          setDrawerDragHardwareIndex(idx);
                                          setDrawerDragIndex(drawerIdx);
                                          setDrawerDragOverIndex(drawerIdx);
                                          e.dataTransfer.effectAllowed = "move";
                                          e.dataTransfer.setData("text/plain", `drawer_${idx}_${drawerIdx}`);
                                        }}
                                        onDragEnd={() => {
                                          setDrawerDragHardwareIndex(null);
                                          setDrawerDragIndex(null);
                                          setDrawerDragOverIndex(null);
                                        }}
                                        className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] text-[#475467] active:cursor-grabbing"
                                        title="Drag to reorder"
                                      >
                                        <GripVertical size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => updateHardwareJsonList(idx, "drawersJson", (items) => items.filter((_, i) => i !== drawerIdx))}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                                      >
                                        <X size={15} strokeWidth={2.8} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => toggleDrawerRowExpanded(idx, drawerIdx)}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7]"
                                        title={isExpanded ? "Collapse" : "Expand"}
                                      >
                                        <img
                                          src="/Arrow.png"
                                          alt="Expand"
                                          className={`h-3 w-3 transition-transform ${isExpanded ? "[transform:rotate(90deg)_scaleX(-1)]" : "[transform:rotate(270deg)_scaleX(-1)]"}`}
                                        />
                                      </button>
                                      <input
                                        value={readDrawerName(drawer)}
                                        onChange={(e) =>
                                          updateHardwareJsonList(idx, "drawersJson", (items) =>
                                            items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "name", e.target.value) : v)),
                                          )
                                        }
                                        placeholder="Drawer name"
                                        className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                      />
                                      {hasDrawerDefault ? (
                                        Boolean(drawer.default) ? (
                                          <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#475467]">
                                            <input
                                              type="checkbox"
                                              checked
                                              onChange={(e) => {
                                                if (!e.target.checked) {
                                                  updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                    items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "default", false) : v)),
                                                  );
                                                }
                                              }}
                                            />
                                            Default
                                          </label>
                                        ) : (
                                          <span className="inline-block h-7" />
                                        )
                                      ) : (
                                        <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#475467]">
                                          <input
                                            type="checkbox"
                                            checked={Boolean(drawer.default)}
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                  items.map((v, i) => writeDrawerField(v, "default", i === drawerIdx)),
                                                );
                                              }
                                            }}
                                          />
                                          Default
                                        </label>
                                      )}
                                    </div>
                                    {isExpanded && (
                                      <div className="space-y-2 pl-[84px]">
                                        <div className="flex items-center gap-2 text-[12px]">
                                          <p className="w-[70px] font-bold text-[#1E3A62]">Bottoms:</p>
                                          <span className="text-[#475467]">Width</span>
                                          <input
                                            value={readDrawerBottomWidth(drawer)}
                                            onChange={(e) =>
                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "bottomWidth", e.target.value) : v)),
                                              )
                                            }
                                            className="h-7 w-[90px] rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                          />
                                          <span className="text-[#475467]">Depth</span>
                                          <input
                                            value={readDrawerBottomDepth(drawer)}
                                            onChange={(e) =>
                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "bottomDepth", e.target.value) : v)),
                                              )
                                            }
                                            className="h-7 w-[90px] rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                          />
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 text-[12px]">
                                          <p className="w-[70px] font-bold text-[#1E3A62]">Backs:</p>
                                          <span className="text-[#475467]">Width</span>
                                          <input
                                            value={readDrawerBackWidth(drawer)}
                                            onChange={(e) =>
                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "backWidth", e.target.value) : v)),
                                              )
                                            }
                                            className="h-7 w-[90px] rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                          />
                                          <span className="ml-2 text-[#475467]">Heights</span>
                                          <button
                                            type="button"
                                            onClick={() => toggleDrawerHeightsExpanded(idx, drawerIdx)}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7]"
                                            title={(drawerHeightsExpanded[`${idx}:${drawerIdx}:heights`] ?? false) ? "Collapse heights" : "Expand heights"}
                                          >
                                            <img
                                              src="/Arrow.png"
                                              alt="Expand heights"
                                              className={`h-3 w-3 transition-transform ${(drawerHeightsExpanded[`${idx}:${drawerIdx}:heights`] ?? false) ? "[transform:rotate(90deg)_scaleX(-1)]" : "[transform:rotate(270deg)_scaleX(-1)]"}`}
                                            />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const next = window.prompt("Add back height (example: M 500)");
                                              const value = toStr(next);
                                              if (!value) return;
                                              const current = readDrawerBackHeights(drawer);
                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "backHeights", [...current, value]) : v)),
                                              );
                                            }}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#A9DDBF] bg-[#EAF8F0] text-[#1F8A4C] hover:bg-[#DDF2E7]"
                                            title="Add back height"
                                          >
                                            <Plus size={13} strokeWidth={2.8} />
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
                                                      className="inline-flex h-6 min-w-[28px] items-center justify-center rounded-[999px] border border-[#D8DEE8] bg-white px-2 text-[11px] font-semibold text-[#334155]"
                                                      title={height}
                                                    >
                                                      {readDrawerHeightLabel(height)}
                                                    </span>
                                                  ))}
                                                  {heightRows.length === 0 && (
                                                    <span className="text-[11px] text-[#667085]">No heights</span>
                                                  )}
                                                </div>
                                              );
                                            }
                                            const firstHeight = heightRows[0];
                                            const remainingHeights = heightRows.slice(1);
                                            if (!firstHeight) {
                                              return (
                                                <div className="self-start">
                                                  <span className="text-[11px] text-[#667085]">No heights</span>
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
                                                    className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                                                  >
                                                    <X size={13} strokeWidth={2.8} />
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
                                                    className="h-7 w-[92px] rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                                    title={firstHeight}
                                                  />
                                                  <span className="inline-flex h-7 min-w-[56px] items-center justify-center rounded-[999px] border border-[#D8DEE8] bg-white px-2 text-[11px] font-semibold text-[#334155]">
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
                                                            className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                                                          >
                                                            <X size={13} strokeWidth={2.8} />
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
                                                            className="h-7 w-[92px] rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                                            title={height}
                                                          />
                                                          <span className="inline-flex h-7 min-w-[56px] items-center justify-center rounded-[999px] border border-[#D8DEE8] bg-white px-2 text-[11px] font-semibold text-[#334155]">
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
                                          <p className="w-[120px] font-bold text-[#1E3A62]">Hardware Lengths:</p>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const next = window.prompt("Add hardware length (number)");
                                              const value = toStr(next);
                                              if (!value) return;
                                              const current = readDrawerLengths(drawer);
                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "hardwareLengths", [...current, value]) : v)),
                                              );
                                            }}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#A9DDBF] bg-[#EAF8F0] text-[#1F8A4C] hover:bg-[#DDF2E7]"
                                            title="Add hardware length"
                                          >
                                            <Plus size={13} strokeWidth={2.8} />
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
                                                  className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                                                >
                                                  <X size={13} strokeWidth={2.8} />
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
                                                  className="h-7 w-[90px] rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                                />
                                              </div>
                                            ))}
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-2 text-[12px]">
                                          <p className="w-[120px] font-bold text-[#1E3A62]">Depth Requirement</p>
                                          <input
                                            value={readDrawerSpaceRequirement(drawer)}
                                            onChange={(e) =>
                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "spaceRequirement", e.target.value) : v)),
                                              )
                                            }
                                            className="h-7 w-[120px] rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
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
                              <div
                                className="space-y-2 rounded-[8px] border p-2"
                                style={{ backgroundColor: tintHex(row.color || "#7D99B3", 0.82), borderColor: row.color || "#7D99B3" }}
                              >
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] font-extrabold uppercase tracking-[0.6px] text-[#1E3A62]">Hinges</p>
                            <button
                              onClick={() => updateHardwareJsonList(idx, "hingesJson", (items) => [...items, { name: "" }])}
                              className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]"
                            >
                              + Add Hinge
                            </button>
                          </div>
                          <div className="space-y-2">
                            <div className="grid grid-cols-4 gap-2">
                              {parseJsonObjects(row.hingesJson).map((hinge, hingeIdx) => (
                                <div key={hingeIdx} className="grid grid-cols-[26px_1fr] items-center gap-2 rounded-[8px] border border-[#D8DEE8] bg-white p-1">
                                  <button
                                    type="button"
                                    onClick={() => updateHardwareJsonList(idx, "hingesJson", (items) => items.filter((_, i) => i !== hingeIdx))}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                                  >
                                    <X size={15} strokeWidth={2.8} />
                                  </button>
                                  <input
                                    value={toStr(hinge.name)}
                                    onChange={(e) =>
                                      updateHardwareJsonList(idx, "hingesJson", (items) =>
                                        items.map((v, i) => (i === hingeIdx ? { ...v, name: e.target.value } : v)),
                                      )
                                    }
                                    placeholder="Hinge name"
                                    className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                              </div>
                            )}

                            {(hardwareActiveTab[idx] ?? "drawers") === "other" && (
                              <div
                                className="space-y-2 rounded-[8px] border p-2"
                                style={{ backgroundColor: tintHex(row.color || "#7D99B3", 0.82), borderColor: row.color || "#7D99B3" }}
                              >
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] font-extrabold uppercase tracking-[0.6px] text-[#1E3A62]">Other</p>
                            <button
                              onClick={() => updateHardwareJsonList(idx, "otherJson", (items) => [...items, { name: "" }])}
                              className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]"
                            >
                              + Add Other
                            </button>
                          </div>
                          <div className="space-y-2">
                            <div className="grid grid-cols-4 gap-2">
                              {parseJsonObjects(row.otherJson).map((other, otherIdx) => (
                                <div key={otherIdx} className="grid grid-cols-[26px_1fr] items-center gap-2 rounded-[8px] border border-[#D8DEE8] bg-white p-1">
                                  <button
                                    type="button"
                                    onClick={() => updateHardwareJsonList(idx, "otherJson", (items) => items.filter((_, i) => i !== otherIdx))}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                                  >
                                    <X size={15} strokeWidth={2.8} />
                                  </button>
                                  <input
                                    value={toStr(other.name)}
                                    onChange={(e) =>
                                      updateHardwareJsonList(idx, "otherJson", (items) =>
                                        items.map((v, i) => (i === otherIdx ? { ...v, name: e.target.value } : v)),
                                      )
                                    }
                                    placeholder="Other name"
                                    className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
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
                      className="rounded-[8px] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#475467]"
                    >
                      + Add Hardware
                    </button>
                  </div>
                </Panel>
              )}

              {active === "notifications" && (
                <div className="space-y-3">
                  <Panel title="Notification Inbox">
                    <div className="space-y-2 text-[12px]">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void markAllNotifications(true)}
                          disabled={notificationsLoading}
                          className="h-7 rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] px-3 text-[11px] font-bold text-[#475467] disabled:opacity-60"
                        >
                          Mark All Read
                        </button>
                        <button
                          type="button"
                          onClick={() => void markAllNotifications(false)}
                          disabled={notificationsLoading}
                          className="h-7 rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] px-3 text-[11px] font-bold text-[#475467] disabled:opacity-60"
                        >
                          Mark All Unread
                        </button>
                        <p className="text-[11px] text-[#667085]">{notificationsLoading ? "Loading..." : `${notificationsRows.length} notifications`}</p>
                      </div>
                      <div className="max-h-[420px] space-y-2 overflow-auto rounded-[8px] border border-[#E4E7EC] bg-white p-2">
                        {notificationsRows.length === 0 && (
                          <p className="text-[12px] text-[#667085]">No notifications found.</p>
                        )}
                        {notificationsRows.map((row) => (
                          <div key={row.id} className={`rounded-[8px] border px-2 py-2 ${row.read ? "border-[#E4E7EC] bg-white" : "border-[#CFE0FF] bg-[#EEF4FF]"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[12px] font-bold text-[#1F2937]">{row.title || "Notification"}</p>
                              <span className="rounded-[999px] border border-[#D8DEE8] bg-white px-2 py-[1px] text-[10px] font-bold uppercase tracking-[0.5px] text-[#475467]">{row.type || "info"}</span>
                            </div>
                            <p className="mt-1 text-[12px] text-[#334155]">{row.message || "-"}</p>
                            <p className="mt-1 text-[11px] text-[#667085]">{row.createdAtIso || "-"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Panel>
                </div>
              )}

              {active === "backup" && (
                <div className="space-y-3">
                  <Panel title="Quote Output Templates">
                    <div className="grid gap-2 text-[12px] xl:grid-cols-2">
                      <div className="space-y-2">
                        <p className="font-bold text-[#334155]">Header HTML</p>
                        <textarea
                          value={backupTemplate.quoteTemplateHeaderHtml}
                          onChange={(e) => setBackupTemplate((prev) => ({ ...prev, quoteTemplateHeaderHtml: e.target.value }))}
                          className="min-h-[120px] rounded-[8px] border border-[#D8DEE8] bg-white px-2 py-1 text-[11px] text-[#334155]"
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="font-bold text-[#334155]">Footer HTML</p>
                        <textarea
                          value={backupTemplate.quoteTemplateFooterHtml}
                          onChange={(e) => setBackupTemplate((prev) => ({ ...prev, quoteTemplateFooterHtml: e.target.value }))}
                          className="min-h-[120px] rounded-[8px] border border-[#D8DEE8] bg-white px-2 py-1 text-[11px] text-[#334155]"
                        />
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 text-[12px] xl:grid-cols-[1fr_1fr_1fr]">
                      <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                        <p className="font-bold text-[#334155]">Page Size</p>
                        <input value={backupTemplate.quoteTemplatePageSize} onChange={(e) => setBackupTemplate((prev) => ({ ...prev, quoteTemplatePageSize: e.target.value }))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                      </div>
                      <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                        <p className="font-bold text-[#334155]">Margin (mm)</p>
                        <input value={backupTemplate.quoteTemplateMarginMm} onChange={(e) => setBackupTemplate((prev) => ({ ...prev, quoteTemplateMarginMm: e.target.value.replace(/[^\d]/g, "") }))} className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]" />
                      </div>
                      <label className="inline-flex items-center gap-2 text-[12px] font-bold text-[#334155]">
                        <input type="checkbox" checked={backupTemplate.quoteTemplateFooterPinBottom} onChange={() => setBackupTemplate((prev) => ({ ...prev, quoteTemplateFooterPinBottom: !prev.quoteTemplateFooterPinBottom }))} />
                        Footer Pin Bottom
                      </label>
                    </div>
                  </Panel>
                  <Panel title="Backup Snapshot">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-[12px] text-[#475467]">Desktop-key snapshot from current company document for backup verification.</p>
                      <button
                        type="button"
                        onClick={downloadBackupSnapshot}
                        className="h-7 rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] px-3 text-[11px] font-bold text-[#475467]"
                      >
                        Export JSON
                      </button>
                    </div>
                    <pre className="max-h-[360px] overflow-auto rounded-[8px] border border-[#E4E7EC] bg-white p-2 text-[11px] text-[#334155]">
{JSON.stringify({
  companyId: activeCompanyId,
  deletedRetentionDays: form.deletedRetentionDays,
  projectStatuses: statuses,
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
      </AppShell>
    </ProtectedRoute>
  );
}
