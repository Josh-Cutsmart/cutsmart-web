"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Great_Vibes } from "next/font/google";
import { ArrowLeft, ChevronDown, ClipboardList, Cpu, FileSpreadsheet, GitBranch, ListChecks, Lock, Minus, Plus, Printer, Quote, Ruler, Scissors, ShoppingCart, Tag, X } from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx-js-style";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from "firebase/storage";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import {
  fetchCompanyDoc,
  fetchCompanyMembers,
  fetchChanges,
  fetchCutlists,
  fetchProjectById,
  fetchQuotes,
  grantTempProductionAccess,
  resyncCompanyProjectTagUsage,
  saveCompanyDocPatch,
  softDeleteProject,
  updateProjectPatch,
  updateProjectStatus,
  updateProjectTags,
} from "@/lib/firestore-data";
import type { CompanyMemberOption } from "@/lib/firestore-data";
import { getProductionUnlockRemainingSeconds, projectTabAccess } from "@/lib/permissions";
import { fetchCompanyAccess, type CompanyAccessInfo } from "@/lib/membership";
import { QUOTE_TEMPLATE_PLACEHOLDERS } from "@/lib/quote-template-placeholders";
import type { Cutlist, Project, ProjectChange, SalesQuote } from "@/lib/types";
import { storage } from "@/lib/firebase";

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const greatVibesFont = Great_Vibes({ subsets: ["latin"], weight: "400" });
void greatVibesFont;

const tabItems = [
  { value: "general", label: "General" },
  { value: "sales", label: "Sales" },
  { value: "production", label: "Production" },
  { value: "settings", label: "Settings" },
];

type ProjectStatusRow = { name: string; color: string };
const statusDefaults = ["New", "Quoting", "Drafting", "Ready for CNC", "Running", "In Production", "Paused", "Completed"];

function fallbackStatusPillColors(status: string) {
  const key = String(status || "").trim().toLowerCase();
  const defaults: Record<string, string> = {
    new: "#3060D0",
    running: "#2A7A3B",
    "in production": "#2A7A3B",
    drafting: "#6B4FB3",
    quoting: "#C77700",
    "ready for cnc": "#3060D0",
    completed: "#2A7A3B",
    paused: "#A05A00",
    complete: "#2A7A3B",
    "on hold": "#C77700",
  };
  const bg = defaults[key] ?? "#64748B";
  return { backgroundColor: bg, color: "#FFFFFF" };
}

function normalizeProjectStatuses(raw: unknown): ProjectStatusRow[] {
  if (!Array.isArray(raw)) {
    return [
      { name: "New", color: "#3060D0" },
      { name: "In Production", color: "#2A7A3B" },
      { name: "On Hold", color: "#C77700" },
      { name: "Complete", color: "#2A7A3B" },
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
        { name: "In Production", color: "#2A7A3B" },
        { name: "On Hold", color: "#C77700" },
        { name: "Complete", color: "#2A7A3B" },
      ];
}

function shortDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  return d.toLocaleString();
}

function dashboardStyleDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  const date = new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-NZ", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .toLowerCase()
    .replace(" ", "");
  return `${date} | ${time}`;
}

function dashboardStyleDateOnly(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}

function quoteColumnWidthPercent(span: number): number {
  const safeSpan = Math.max(1, Math.min(12, Number(span) || 12));
  return (safeSpan / 12) * 100;
}

function quotePaperDimensionsFor(pageSize: string): { widthMm: number; heightMm: number } {
  const key = String(pageSize || "").trim().toUpperCase();
  switch (key) {
    case "A3":
      return { widthMm: 297, heightMm: 420 };
    case "A5":
      return { widthMm: 148, heightMm: 210 };
    case "LETTER":
      return { widthMm: 216, heightMm: 279 };
    case "LEGAL":
      return { widthMm: 216, heightMm: 356 };
    case "A4":
    default:
      return { widthMm: 210, heightMm: 297 };
  }
}

function quoteBlockCountsAsContent(block: QuoteTemplateBlock): boolean {
  return block.type !== "divider" && block.type !== "spacer";
}

function normalizePersonLookup(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeSalesQuoteExtras(raw: unknown): SalesQuoteExtraRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => {
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      return {
        id: String(row.id ?? `quote_extra_${(name || "row").toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${idx + 1}`).trim(),
        name,
        price: String(row.price ?? "").trim(),
        defaultIncluded: Boolean(row.defaultIncluded ?? row.default),
        templateContainerId: String(row.templateContainerId ?? "").trim(),
        templateBlockId: String(row.templateBlockId ?? "").trim(),
        templatePlaceholderKey: String(row.templatePlaceholderKey ?? "").trim(),
      };
    })
    .filter((row) => row.name);
}

function normalizeSalesQuoteHelpers(raw: unknown): SalesQuoteHelperRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => {
      const row = item as Record<string, unknown>;
      const content = sanitizeQuoteRichTextMarkup(String(row.content ?? ""));
      return {
        id: String(row.id ?? `quote_helper_${idx + 1}`).trim(),
        content,
      };
    })
    .filter((row) => row.content.trim());
}

function extractClientRegion(address: unknown, explicitRegion?: unknown): string {
  const directRegion = String(explicitRegion ?? "").trim();
  if (directRegion) return directRegion;

  const rawAddress = String(address ?? "").replace(/\r/g, "").trim();
  if (!rawAddress) return "";

  const commaParts = rawAddress
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (commaParts.length >= 2) {
    return commaParts[1] || "";
  }

  const lineParts = rawAddress
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
  if (lineParts.length >= 2) {
    return lineParts[1] || "";
  }

  return "";
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

function arraysEqualText(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function normalizeQuoteBoxStyle(raw: unknown): QuoteTemplateBoxStyle {
  if (!raw || typeof raw !== "object") return {};
  const item = raw as Record<string, unknown>;
  return {
    borderColor: toStr(item.borderColor),
    borderWidthPx: toStr(item.borderWidthPx),
    fillColor: toStr(item.fillColor),
    paddingPx: toStr(item.paddingPx),
    paddingTopPx: toStr(item.paddingTopPx),
    paddingBottomPx: toStr(item.paddingBottomPx),
    paddingLeftPx: toStr(item.paddingLeftPx),
    paddingRightPx: toStr(item.paddingRightPx),
    marginPx: toStr(item.marginPx),
  };
}

function quoteSafePixelString(value: string | undefined): string | undefined {
  const num = Number.parseInt(String(value ?? "").replace(/[^\d-]/g, ""), 10);
  if (!Number.isFinite(num)) return undefined;
  return `${num}px`;
}

type DrawerHeightOption = { token: string; value: string };
type HardwareDrawerType = {
  name: string;
  isDefault: boolean;
  heightLetters: string[];
  heightOptions: DrawerHeightOption[];
  bottomsWidthMinus: number | null;
  bottomsDepthMinus: number | null;
  backsWidthMinus: number | null;
  hardwareLengths: number[];
  spaceRequirement: number | null;
};
type HardwareTypeRow = { name: string; isDefault: boolean; drawers: HardwareDrawerType[]; hinges: string[]; other: string[] };
type SheetSizeOption = { h: string; w: string; isDefault: boolean };
type BoardColourMemoryRow = { value: string; count: number };
type ProductionBoardRow = {
  id: string;
  colour: string;
  thickness: string;
  finish: string;
  edging: string;
  grain: boolean;
  lacquer: boolean;
  sheetSize: string;
  sheets: string;
  edgetape: string;
};
type ProductionFormState = {
  existing: {
    carcassThickness: string;
    panelThickness: string;
    frontsThickness: string;
  };
  cabinetry: {
    baseCabHeight: string;
    footDistanceBack: string;
    tallCabHeight: string;
    footHeight: string;
    hobCentre: string;
    hobSide: string;
  };
  hardware: {
    hardwareCategory: string;
    newDrawerType: string;
    hingeType: string;
  };
  boardTypes: ProductionBoardRow[];
};
type OrderMiscDraftRow = { name: string; notes: string; qty: string; deleted?: boolean };
type OrderHingeRow = { id: string; name: string; qty: string };

type ProductionNav = "overview" | "cutlist" | "nesting" | "cnc" | "order" | "unlock";
type SalesNav = "initial" | "items" | "quote" | "specifications";
type CutlistRow = {
  id: string;
  room: string;
  partType: string;
  board: string;
  name: string;
  height: string;
  width: string;
  depth: string;
  quantity: string;
  clashing: string;
  clashLeft?: string;
  clashRight?: string;
  fixedShelf?: string;
  adjustableShelf?: string;
  fixedShelfDrilling?: string;
  adjustableShelfDrilling?: string;
  information: string;
  grain: boolean;
  grainValue: string;
  includeInNesting?: boolean;
  parentName?: string;
};
type CutlistDraftRow = CutlistRow;
type CabinetryDerivedPiece = {
  key: string;
  partName: string;
  height: string;
  width: string;
  depth: string;
  quantity: string;
  clashLeft: string;
  clashRight: string;
  grainValue?: string;
};
type DrawerDerivedPiece = {
  key: string;
  partName: string;
  height: string;
  width: string;
  depth: string;
  quantity: string;
  clashLeft: string;
  clashRight: string;
};
type CncDisplayRow = CutlistRow & {
  sourceRowId: string;
  cncCabinetryRowKind?: "main" | "fixedShelf" | "adjustableShelf";
};
type SalesRoomRow = { name: string; included: boolean; totalPrice: string };
type SalesProductRow = { name: string; selected: boolean };
type SalesQuoteExtraRow = {
  id: string;
  name: string;
  price: string;
  defaultIncluded: boolean;
  templateContainerId: string;
  templateBlockId: string;
  templatePlaceholderKey: string;
};
type SalesQuoteHelperRow = {
  id: string;
  content: string;
};
type QuoteTemplateBlockType =
  | "text"
  | "projectText"
  | "logo"
  | "companyDetails"
  | "clientDetails"
  | "quoteMeta"
  | "roomBreakdown"
  | "totals"
  | "notes"
  | "terms"
  | "customText"
  | "divider"
  | "spacer";
type QuoteTemplateBlock = {
  id: string;
  type: QuoteTemplateBlockType;
  label: string;
  enabled: boolean;
  content: string;
  heightMm?: string;
  textColor?: string;
};
type QuoteTemplateBoxStyle = {
  borderColor?: string;
  borderWidthPx?: string;
  fillColor?: string;
  paddingPx?: string;
  paddingTopPx?: string;
  paddingBottomPx?: string;
  paddingLeftPx?: string;
  paddingRightPx?: string;
  marginPx?: string;
};
type QuoteTemplateColumn = {
  id: string;
  span: number;
  style?: QuoteTemplateBoxStyle;
  blocks: QuoteTemplateBlock[];
};
type QuoteTemplateContainer = {
  id: string;
  title: string;
  enabled: boolean;
  mount: "flow" | "top" | "bottom";
  style?: QuoteTemplateBoxStyle;
  columns: QuoteTemplateColumn[];
};
type QuoteLayoutTemplate = {
  version: number;
  templateName: string;
  pageSize: string;
  marginMm: string;
  containers: QuoteTemplateContainer[];
};
type CutlistEditableField =
  | "room"
  | "partType"
  | "board"
  | "name"
  | "height"
  | "width"
  | "depth"
  | "quantity"
  | "clashing"
  | "information"
  | "grain";
type CutlistActivityEntry = {
  id: number;
  scope?: "production" | "initial";
  message: string;
  action?: string;
  actionKind?: "clear" | "undo" | "";
  dedupeKey?: string;
  partType?: string;
  partTypeTo?: string;
  valueFrom?: string;
  valueTo?: string;
};

function normalizeCutlistActivityEntries(raw: unknown): CutlistActivityEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const item = entry as Record<string, unknown>;
      const actionKindRaw = String(item.actionKind || "").trim().toLowerCase();
      const actionKind: "" | "clear" | "undo" =
        actionKindRaw === "clear" || actionKindRaw === "undo" ? actionKindRaw : "";
      const scopeRaw = String(item.scope || "").trim().toLowerCase();
      const scope: "production" | "initial" = scopeRaw === "initial" ? "initial" : "production";
      return {
        id: Number(item.id || 0),
        scope,
        message: String(item.message || "").trim(),
        action: String(item.action || "").trim(),
        actionKind,
        dedupeKey: String(item.dedupeKey || "").trim(),
        partType: String(item.partType || "").trim(),
        partTypeTo: String(item.partTypeTo || "").trim(),
        valueFrom: String(item.valueFrom || "").trim(),
        valueTo: String(item.valueTo || "").trim(),
      } satisfies CutlistActivityEntry;
    })
    .filter((entry) => entry.message)
    .slice(-120);
}

function serializeCutlistActivityFeedForProject(feed: CutlistActivityEntry[]) {
  return {
    production: feed.filter((entry) => (entry.scope || "production") === "production").slice(-120),
    initial: feed.filter((entry) => (entry.scope || "production") === "initial").slice(-120),
  };
}

type CutlistValidationIssue = {
  field: "partType" | "board" | "name" | "height" | "width" | "depth" | "quantity";
  message: string;
};

function toStr(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function parseCurrencyNumber(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrencyValue(value: number): string {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.max(0, value));
}

type ProjectFileEntry = {
  id: string;
  name: string;
  path: string;
  url: string;
  size: number;
  contentType: string;
  uploadedAtIso: string;
};
type EdgebandingRuleRow = { upToMeters: string; addMeters: string };

const PROJECT_FILE_TOTAL_LIMIT_BYTES = 10 * 1024 * 1024;
const PROJECT_FILE_ACCEPT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
  "rtf",
  "dwg",
  "dxf",
  "zip",
];

function extensionFromPathLike(value: string): string {
  const clean = String(value || "").split("?")[0].split("#")[0];
  const idx = clean.lastIndexOf(".");
  if (idx < 0) return "";
  return clean.slice(idx + 1).trim().toLowerCase();
}

function isProjectFileImageLike(row: Record<string, unknown>): boolean {
  const contentType = String(row.contentType ?? row.mimeType ?? row.type ?? "").trim().toLowerCase();
  if (contentType.startsWith("image/")) return true;
  const candidates = [
    String(row.name ?? "").trim(),
    String(row.path ?? "").trim(),
    String(row.url ?? "").trim(),
  ];
  for (const item of candidates) {
    const ext = extensionFromPathLike(item);
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif"].includes(ext)) return true;
  }
  return false;
}

function normalizeProjectFileEntries(project: Project | null): ProjectFileEntry[] {
  if (!project) return [];
  const rows = Array.isArray(project.projectFiles) ? project.projectFiles : [];
  const out: ProjectFileEntry[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const raw = rows[i];
    if (raw && typeof raw === "object") {
      const item = raw as Record<string, unknown>;
      const name = String(item.name ?? "").trim() || `File ${i + 1}`;
      const path = String(item.path ?? "").trim();
      const url = String(item.url ?? "").trim();
      const id = String(item.id ?? "").trim() || `${path || url || name}_${i}`;
      out.push({
        id,
        name,
        path,
        url,
        size: Math.max(0, Number(item.size ?? 0) || 0),
        contentType: String(item.contentType ?? item.mimeType ?? item.type ?? "").trim(),
        uploadedAtIso: String(item.uploadedAtIso ?? item.uploadedAt ?? "").trim(),
      });
      continue;
    }
    const asText = String(raw ?? "").trim();
    if (!asText) continue;
    out.push({
      id: `${asText}_${i}`,
      name: asText.split("/").pop() || `File ${i + 1}`,
      path: asText,
      url: "",
      size: 0,
      contentType: "",
      uploadedAtIso: "",
    });
  }
  return out;
}

function formatBytes(bytes: number): string {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatProjectFileTotal(bytes: number): string {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (value <= 0) return "0 / 10mb";
  const mb = value / (1024 * 1024);
  return `${mb.toFixed(1)} / 10mb`;
}

async function resolveProjectFileUrl(entry: ProjectFileEntry): Promise<string> {
  if (entry.url) return entry.url;
  const path = String(entry.path || "").trim();
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (!storage) return "";
  try {
    return await getDownloadURL(storageRef(storage, path.replace(/^\/+/, "")));
  } catch {
    try {
      return await getDownloadURL(storageRef(storage, path));
    } catch {
      return "";
    }
  }
}

function collectProjectImageRefs(project: Project | null): string[] {
  if (!project) return [];
  const direct = Array.isArray(project.projectImages) ? project.projectImages : [];
  const fromFiles = Array.isArray(project.projectFiles)
    ? project.projectFiles
        .map((row) => {
          if (!row || typeof row !== "object") return "";
          const item = row as Record<string, unknown>;
          if (!isProjectFileImageLike(item)) return "";
          return String(item.path ?? item.url ?? "").trim();
        })
        .filter(Boolean)
    : [];
  return Array.from(new Set([...direct.map((v) => String(v || "").trim()), ...fromFiles])).filter(Boolean);
}

async function resolveProjectImageUrl(raw: string): Promise<string> {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const storageClient = storage;
  if (!storageClient) return "";
  const normalized = value.replace(/^\/+/, "");
  try {
    return await getDownloadURL(storageRef(storageClient, normalized));
  } catch {
    try {
      return await getDownloadURL(storageRef(storageClient, value));
    } catch {
      return "";
    }
  }
}

function toNum(value: unknown): number {
  const n = Number.parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parsePositiveNumber(value: unknown): number | null {
  const n = Number.parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseSheetSizePair(value: string): [number, number] | null {
  const src = String(value || "").trim();
  if (!src) return null;
  const m = src.match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const a = Number.parseFloat(m[1] || "");
  const b = Number.parseFloat(m[2] || "");
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  return [a, b];
}

function normalizeCutlistDimensionValue(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/nan/i.test(raw) || /undefined|null/i.test(raw)) return "";
  if (/^0+(?:\.0+)?$/.test(raw)) return "";
  return raw;
}

function parseCutlistGrainFields(rawGrain: unknown, rawBoolean?: unknown): { grain: boolean; grainValue: string } {
  const raw = String(rawGrain ?? "").trim();
  const lower = raw.toLowerCase();
  if (!raw) {
    return { grain: Boolean(rawBoolean), grainValue: "" };
  }
  if (lower === "yes" || lower === "true") return { grain: true, grainValue: "" };
  if (lower === "no" || lower === "false" || lower === "0") return { grain: false, grainValue: "" };
  return { grain: true, grainValue: raw };
}

function formatMm(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.?0+$/, "");
}

function sanitizeDerivedValue(value: unknown): string {
  const txt = String(value ?? "").trim();
  if (!txt) return "";
  const lower = txt.toLowerCase();
  if (lower === "nan" || lower === "undefined" || lower === "null") return "";
  if (/nan/i.test(txt)) return "";
  return txt;
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function notesToDisplayHtml(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw.trim()) return "";
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(raw);
  if (looksLikeHtml) return raw;
  return escapeHtml(raw).replace(/\n/g, "<br />");
}

function formatPartCount(value: number): string {
  const count = Math.max(0, Number.isFinite(value) ? Math.round(value) : 0);
  return `${count} ${count === 1 ? "Part" : "Parts"}`;
}

function createEmptyCutlistEntry(): Omit<CutlistRow, "id" | "room"> {
  return {
    partType: "",
    board: "",
    name: "",
    height: "",
    width: "",
    depth: "",
    quantity: "1",
    clashing: "",
    clashLeft: "",
    clashRight: "",
    fixedShelf: "",
    adjustableShelf: "",
    fixedShelfDrilling: "No",
    adjustableShelfDrilling: "No",
    information: "",
    grain: false,
    grainValue: "",
  };
}

function makeQuoteTemplateId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function createProjectQuoteTemplateBlock(type: QuoteTemplateBlockType): QuoteTemplateBlock {
  const labelMap: Record<QuoteTemplateBlockType, string> = {
    text: "Text",
    projectText: "Project Text",
    logo: "Logo",
    companyDetails: "Company Details",
    clientDetails: "Client Details",
    quoteMeta: "Quote Meta",
    roomBreakdown: "Room Breakdown",
    totals: "Totals",
    notes: "Notes",
    terms: "Terms",
    customText: "Custom Text",
    divider: "Divider",
    spacer: "Spacer",
  };
  return {
    id: makeQuoteTemplateId("quote_block"),
    type,
    label: labelMap[type] ?? "Block",
    enabled: true,
    content:
      type === "text"
        ? "Type your quote text here."
        : type === "projectText"
          ? "Type project-specific quote text here."
        : type === "customText"
        ? "Dear {{client_name}},\n\nThank you for the opportunity to quote {{project_name}}.\n\nKind regards,\n{{project_creator}}"
        : type === "notes"
          ? "{{project_notes}}"
          : type === "terms"
            ? "Quote valid for 30 days.\nLead times and final details are confirmed on approval."
            : "",
    heightMm: type === "spacer" ? "12" : "",
  };
}

function createProjectQuoteTemplateColumn(span: number, blocks: QuoteTemplateBlock[] = []): QuoteTemplateColumn {
  return {
    id: makeQuoteTemplateId("quote_col"),
    span,
    style: {},
    blocks,
  };
}

function createProjectQuoteTemplateContainer(
  title: string,
  columns: QuoteTemplateColumn[],
): QuoteTemplateContainer {
  return {
    id: makeQuoteTemplateId("quote_container"),
    title,
    enabled: true,
    mount: "flow",
    style: {},
    columns,
  };
}

function defaultProjectQuoteTemplate(): QuoteLayoutTemplate {
  return {
    version: 1,
    templateName: "Company Quote Layout",
    pageSize: "A4",
    marginMm: "12",
    containers: [
      createProjectQuoteTemplateContainer("Header", [
        createProjectQuoteTemplateColumn(6, [createProjectQuoteTemplateBlock("quoteMeta")]),
        createProjectQuoteTemplateColumn(6, [createProjectQuoteTemplateBlock("logo"), createProjectQuoteTemplateBlock("companyDetails")]),
      ]),
      createProjectQuoteTemplateContainer("Client", [
        createProjectQuoteTemplateColumn(6, [createProjectQuoteTemplateBlock("clientDetails")]),
        createProjectQuoteTemplateColumn(6, [createProjectQuoteTemplateBlock("customText")]),
      ]),
      createProjectQuoteTemplateContainer("Quote Body", [
        createProjectQuoteTemplateColumn(12, [createProjectQuoteTemplateBlock("roomBreakdown"), createProjectQuoteTemplateBlock("totals")]),
      ]),
      createProjectQuoteTemplateContainer("Closing", [
        createProjectQuoteTemplateColumn(12, [createProjectQuoteTemplateBlock("notes"), createProjectQuoteTemplateBlock("terms")]),
      ]),
    ],
  };
}

function normalizeProjectQuoteTemplateColumn(raw: unknown): QuoteTemplateColumn | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const blocks = Array.isArray(item.blocks) ? item.blocks.map(normalizeProjectQuoteTemplateBlock).filter(Boolean) as QuoteTemplateBlock[] : [];
  const span = Number(item.span || 0);
  return {
    id: toStr(item.id, makeQuoteTemplateId("quote_col")),
    span: Number.isFinite(span) && span > 0 ? span : 12,
    style: normalizeQuoteBoxStyle(item.style),
    blocks,
  };
}

function normalizeProjectQuoteTemplateContainer(raw: unknown): QuoteTemplateContainer | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const columns = Array.isArray(item.columns) ? item.columns.map(normalizeProjectQuoteTemplateColumn).filter(Boolean) as QuoteTemplateColumn[] : [];
  return {
    id: toStr(item.id, makeQuoteTemplateId("quote_container")),
    title: toStr(item.title, "Container"),
    enabled: item.enabled !== false,
    mount: toStr(item.mount) === "top" ? "top" : toStr(item.mount) === "bottom" ? "bottom" : "flow",
    style: normalizeQuoteBoxStyle(item.style),
    columns: columns.length ? columns.slice(0, 6) : [createProjectQuoteTemplateColumn(12)],
  };
}

function normalizeLegacyProjectQuoteTemplateSection(raw: unknown): QuoteTemplateContainer | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const layout = toStr(item.layout) === "two-column";
  const leftBlocks = Array.isArray(item.leftBlocks) ? item.leftBlocks.map(normalizeProjectQuoteTemplateBlock).filter(Boolean) as QuoteTemplateBlock[] : [];
  const rightBlocks = Array.isArray(item.rightBlocks) ? item.rightBlocks.map(normalizeProjectQuoteTemplateBlock).filter(Boolean) as QuoteTemplateBlock[] : [];
    return {
      id: toStr(item.id, makeQuoteTemplateId("quote_container")),
      title: toStr(item.title, "Container"),
      enabled: item.enabled !== false,
      mount: "flow",
      style: {},
      columns: layout
        ? [createProjectQuoteTemplateColumn(6, leftBlocks), createProjectQuoteTemplateColumn(6, rightBlocks)]
        : [createProjectQuoteTemplateColumn(12, leftBlocks)],
  };
}

function normalizeProjectQuoteTemplate(raw: unknown): QuoteLayoutTemplate {
  const fallback = defaultProjectQuoteTemplate();
  if (!raw || typeof raw !== "object") return fallback;
  const item = raw as Record<string, unknown>;
  const containers = Array.isArray(item.containers)
    ? item.containers.map(normalizeProjectQuoteTemplateContainer).filter(Boolean) as QuoteTemplateContainer[]
    : [];
  const legacyContainers = !containers.length && Array.isArray(item.sections)
    ? item.sections.map(normalizeLegacyProjectQuoteTemplateSection).filter(Boolean) as QuoteTemplateContainer[]
    : [];
  return {
    version: Number(item.version || 1) || 1,
    templateName: toStr(item.templateName, fallback.templateName),
    pageSize: toStr(item.pageSize, fallback.pageSize),
    marginMm: toStr(item.marginMm, fallback.marginMm),
    containers: containers.length ? containers : legacyContainers.length ? legacyContainers : fallback.containers,
  };
}

function normalizeProjectQuoteTemplateBlock(raw: unknown): QuoteTemplateBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const type = toStr(item.type) as QuoteTemplateBlockType;
  const validTypes: QuoteTemplateBlockType[] = ["text", "projectText", "logo", "companyDetails", "clientDetails", "quoteMeta", "roomBreakdown", "totals", "notes", "terms", "customText", "divider", "spacer"];
  if (!validTypes.includes(type)) return null;
  return {
    id: toStr(item.id, makeQuoteTemplateId("quote_block")),
    type,
    label: toStr(item.label, createProjectQuoteTemplateBlock(type).label),
    enabled: item.enabled !== false,
    content: toStr(item.content),
    heightMm: toStr(item.heightMm),
    textColor: toStr(item.textColor),
  };
}

function stripHtmlToPlainText(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw.trim()) return "";
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function interpolateQuoteTemplateText(value: string, replacements: Record<string, string>): string {
  return String(value || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const lookup = replacements[key];
    return lookup == null ? "" : String(lookup);
  });
}

function cabinetPreviewRatioFromDims(widthMm: number, heightMm: number, depthMm: number): number {
  const w = Math.max(0, Number(widthMm) || 0);
  const h = Math.max(0, Number(heightMm) || 0);
  const d = Math.max(0, Number(depthMm) || 0);
  if (w <= 0 || h <= 0 || d <= 0) return 1;
  const maxDim = Math.max(w, h, d, 1);
  const frontW = Math.max(54, Math.min(122, (w / maxDim) * 122));
  const frontH = Math.max(62, Math.min(132, (h / maxDim) * 132));
  const depthX = Math.max(14, Math.min(56, (d / maxDim) * 56));
  const depthY = Math.max(10, Math.min(30, (d / maxDim) * 30));
  const drawW = frontW + depthX;
  const drawH = frontH + depthY;
  return drawH > 0 ? drawW / drawH : 1;
}

function CabinetIsoPreview({
  widthMm,
  heightMm,
  depthMm,
  thicknessMm,
  fixedShelfCount,
  adjustableShelfCount,
}: {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  thicknessMm: number;
  fixedShelfCount: number;
  adjustableShelfCount: number;
}) {
  const w = Math.max(0, Number(widthMm) || 0);
  const h = Math.max(0, Number(heightMm) || 0);
  const d = Math.max(0, Number(depthMm) || 0);
  const t = Math.max(0, Number(thicknessMm) || 0);
  if (w <= 0 || h <= 0 || d <= 0) {
    return (
      <div className="flex h-[170px] items-center justify-center rounded-[8px] border border-dashed border-[#CBD5E1] bg-[#F8FAFC] text-[11px] font-semibold text-[#64748B]">
        No size
      </div>
    );
  }

  // Keep CNC window preview proportions aligned with export/PDF geometry.
  const maxDim = Math.max(w, h, d, 1);
  const frontW = Math.max(54, Math.min(122, (w / maxDim) * 122));
  const frontH = Math.max(62, Math.min(132, (h / maxDim) * 132));
  const depthX = Math.max(14, Math.min(56, (d / maxDim) * 56));
  const depthY = Math.max(10, Math.min(30, (d / maxDim) * 30));

  const drawW = frontW + depthX;
  const drawH = frontH + depthY;
  const viewInset = 2;
  const svgW = Math.max(1, drawW + viewInset * 2);
  const svgH = Math.max(1, drawH + viewInset * 2);
  const frontX = viewInset;
  const frontY = depthY + viewInset;
  const rightX = frontX + frontW;
  const bottomY = frontY + frontH;
  const panelT = Math.max(2, Math.min(14, t > 0 ? (t / maxDim) * 122 : 4));
  const innerX = frontX + panelT;
  const innerY = frontY + panelT;
  const innerW = Math.max(8, frontW - panelT * 2);
  const innerH = Math.max(8, frontH - panelT * 2);
  const innerRight = innerX + innerW;
  const innerBottom = innerY + innerH;
  const cavityOffX = depthX * 0.78;
  const cavityOffY = depthY * 0.78;
  const backX = innerX + cavityOffX;
  const backY = innerY - cavityOffY;
  const backRight = backX + innerW;
  const backBottom = backY + innerH;

  const topPoly = `${frontX},${frontY} ${rightX},${frontY} ${rightX + depthX},${frontY - depthY} ${frontX + depthX},${frontY - depthY}`;
  const sidePoly = `${rightX},${frontY} ${rightX + depthX},${frontY - depthY} ${rightX + depthX},${bottomY - depthY} ${rightX},${bottomY}`;
  const frameInnerH = Math.max(0, frontH - panelT * 2);
  const frameInnerW = Math.max(0, frontW - panelT * 2);
  const frameCenterY = frontY + panelT;
  const frameCenterX = frontX + panelT;
  const totalShelves = Math.max(0, fixedShelfCount) + Math.max(0, adjustableShelfCount);
  const fixedCount = Math.max(0, fixedShelfCount);
  const shelfRows = Math.min(10, totalShelves);
  const shelfT = Math.max(1.5, Math.min(8, panelT * 0.9));
  const shelfBoards = Array.from({ length: shelfRows }, (_v, idx) => {
    const y = innerY + ((idx + 1) * innerH) / (shelfRows + 1);
    const yBottom = y + shelfT;
    const isAdjustable = idx >= fixedCount;
    const shelfTopPoly = `${innerX},${y} ${innerRight},${y} ${innerRight + cavityOffX},${y - cavityOffY} ${innerX + cavityOffX},${y - cavityOffY}`;
    const shelfBottomPoly = `${innerX},${yBottom} ${innerRight},${yBottom} ${innerRight + cavityOffX},${yBottom - cavityOffY} ${innerX + cavityOffX},${yBottom - cavityOffY}`;
    const shelfFrontFace = `${innerX},${y} ${innerRight},${y} ${innerRight},${yBottom} ${innerX},${yBottom}`;
    const shelfRightFace = `${innerRight},${y} ${innerRight + cavityOffX},${y - cavityOffY} ${innerRight + cavityOffX},${yBottom - cavityOffY} ${innerRight},${yBottom}`;
    return (
      <g key={`cab_shelf_${idx}`}>
        <polygon
          points={shelfBottomPoly}
          fill={isAdjustable ? "#C6D2E2" : "#B8C5D9"}
          stroke={isAdjustable ? "#64748B" : "#334155"}
          strokeWidth={0.65}
        />
        <polygon
          points={shelfRightFace}
          fill={isAdjustable ? "#B7C4D7" : "#A9B8CE"}
          stroke={isAdjustable ? "#64748B" : "#334155"}
          strokeWidth={0.65}
        />
        <polygon
          points={shelfFrontFace}
          fill={isAdjustable ? "#D3DDEA" : "#C6D2E2"}
          stroke={isAdjustable ? "#64748B" : "#334155"}
          strokeWidth={0.65}
        />
        <polygon
          points={shelfTopPoly}
          fill={isAdjustable ? "#DCE3EC" : "#CCD6E4"}
          stroke={isAdjustable ? "#64748B" : "#334155"}
          strokeWidth={0.9}
          strokeDasharray={isAdjustable ? "4 2" : undefined}
        />
      </g>
    );
  });

  return (
    <div className="w-[220px] shrink-0 self-stretch p-[10px]">
      <div className="relative h-full w-full">
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
      >
        <rect x={frontX} y={frontY} width={frontW} height={frontH} fill="#E9EFF8" stroke="#475569" strokeWidth="1.2" />
        <polygon
          points={`${innerX},${innerY} ${innerRight},${innerY} ${backRight},${backY} ${backX},${backY}`}
          fill="#EEF3FA"
          stroke="#90A2BA"
          strokeWidth="0.8"
        />
        <polygon
          points={`${innerRight},${innerY} ${innerRight},${innerBottom} ${backRight},${backBottom} ${backRight},${backY}`}
          fill="#E3EAF4"
          stroke="#90A2BA"
          strokeWidth="0.8"
        />
        <polygon
          points={`${innerX},${innerY} ${innerX},${innerBottom} ${backX},${backBottom} ${backX},${backY}`}
          fill="#EAF0F8"
          stroke="#90A2BA"
          strokeWidth="0.8"
        />
        <polygon
          points={`${innerX},${innerBottom} ${innerRight},${innerBottom} ${backRight},${backBottom} ${backX},${backBottom}`}
          fill="#E7EEF7"
          stroke="#90A2BA"
          strokeWidth="0.8"
        />
        <rect x={backX} y={backY} width={innerW} height={innerH} fill="#F4F8FD" stroke="#91A4BC" strokeWidth="0.8" />
        {shelfBoards}
        <rect x={innerX} y={innerY} width={innerW} height={innerH} fill="none" stroke="#5B6F88" strokeWidth="0.95" />
        <polygon points={topPoly} fill="#D6DFEC" stroke="#64748B" strokeWidth="1.1" />
        <rect x={frontX} y={frontY} width={frontW} height={panelT} fill="#E9EFF8" />
        <rect x={frontX} y={frameCenterY} width={panelT} height={frameInnerH} fill="#E9EFF8" />
        <rect x={rightX - panelT} y={frameCenterY} width={panelT} height={frameInnerH} fill="#E9EFF8" />
        <rect x={frameCenterX} y={bottomY - panelT} width={frameInnerW} height={panelT} fill="#E9EFF8" />
        <polygon points={sidePoly} fill="#BFCBDD" stroke="#64748B" strokeWidth="1.1" />
      </svg>
      </div>
    </div>
  );
}

function buildCabinetSvgForExport(
  widthMm: number,
  heightMm: number,
  depthMm: number,
  thicknessMm: number,
  fixedShelfCount: number,
  adjustableShelfCount: number,
): { svg: string; svgW: number; svgH: number } | null {
  const w = Math.max(0, Number(widthMm) || 0);
  const h = Math.max(0, Number(heightMm) || 0);
  const d = Math.max(0, Number(depthMm) || 0);
  const t = Math.max(0, Number(thicknessMm) || 0);
  if (w <= 0 || h <= 0 || d <= 0) return null;
  const maxDim = Math.max(w, h, d, 1);
  const frontW = Math.max(54, Math.min(122, (w / maxDim) * 122));
  const frontH = Math.max(62, Math.min(132, (h / maxDim) * 132));
  const depthX = Math.max(14, Math.min(56, (d / maxDim) * 56));
  const depthY = Math.max(10, Math.min(30, (d / maxDim) * 30));
  const drawW = frontW + depthX;
  const drawH = frontH + depthY;
  const viewInset = 2;
  const svgW = Math.max(1, drawW + viewInset * 2);
  const svgH = Math.max(1, drawH + viewInset * 2);
  const frontX = viewInset;
  const frontY = depthY + viewInset;
  const rightX = frontX + frontW;
  const bottomY = frontY + frontH;
  const panelT = Math.max(2, Math.min(14, t > 0 ? (t / maxDim) * 122 : 4));
  const innerX = frontX + panelT;
  const innerY = frontY + panelT;
  const innerW = Math.max(8, frontW - panelT * 2);
  const innerH = Math.max(8, frontH - panelT * 2);
  const innerRight = innerX + innerW;
  const innerBottom = innerY + innerH;
  const cavityOffX = depthX * 0.78;
  const cavityOffY = depthY * 0.78;
  const backX = innerX + cavityOffX;
  const backY = innerY - cavityOffY;
  const backRight = backX + innerW;
  const backBottom = backY + innerH;
  const topPoly = `${frontX},${frontY} ${rightX},${frontY} ${rightX + depthX},${frontY - depthY} ${frontX + depthX},${frontY - depthY}`;
  const sidePoly = `${rightX},${frontY} ${rightX + depthX},${frontY - depthY} ${rightX + depthX},${bottomY - depthY} ${rightX},${bottomY}`;
  const totalShelves = Math.max(0, fixedShelfCount) + Math.max(0, adjustableShelfCount);
  const fixedCount = Math.max(0, fixedShelfCount);
  const shelfRows = Math.min(10, totalShelves);
  const shelfT = Math.max(1.5, Math.min(8, panelT * 0.9));
  const shelfGroups = Array.from({ length: shelfRows }, (_v, idx) => {
    const y = innerY + ((idx + 1) * innerH) / (shelfRows + 1);
    const yBottom = y + shelfT;
    const isAdjustable = idx >= fixedCount;
    const shelfTopPoly = `${innerX},${y} ${innerRight},${y} ${innerRight + cavityOffX},${y - cavityOffY} ${innerX + cavityOffX},${y - cavityOffY}`;
    const shelfBottomPoly = `${innerX},${yBottom} ${innerRight},${yBottom} ${innerRight + cavityOffX},${yBottom - cavityOffY} ${innerX + cavityOffX},${yBottom - cavityOffY}`;
    const shelfFrontFace = `${innerX},${y} ${innerRight},${y} ${innerRight},${yBottom} ${innerX},${yBottom}`;
    const shelfRightFace = `${innerRight},${y} ${innerRight + cavityOffX},${y - cavityOffY} ${innerRight + cavityOffX},${yBottom - cavityOffY} ${innerRight},${yBottom}`;
    return `
      <polygon points="${shelfBottomPoly}" fill="${isAdjustable ? "#C6D2E2" : "#B8C5D9"}" stroke="${isAdjustable ? "#64748B" : "#334155"}" stroke-width="0.65" />
      <polygon points="${shelfRightFace}" fill="${isAdjustable ? "#B7C4D7" : "#A9B8CE"}" stroke="${isAdjustable ? "#64748B" : "#334155"}" stroke-width="0.65" />
      <polygon points="${shelfFrontFace}" fill="${isAdjustable ? "#D3DDEA" : "#C6D2E2"}" stroke="${isAdjustable ? "#64748B" : "#334155"}" stroke-width="0.65" />
      <polygon points="${shelfTopPoly}" fill="${isAdjustable ? "#DCE3EC" : "#CCD6E4"}" stroke="${isAdjustable ? "#64748B" : "#334155"}" stroke-width="0.9" ${isAdjustable ? 'stroke-dasharray="4 2"' : ""} />
    `;
  }).join("");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}">
      <rect x="${frontX}" y="${frontY}" width="${frontW}" height="${frontH}" fill="#E9EFF8" stroke="#475569" stroke-width="1.2" />
      <polygon points="${innerX},${innerY} ${innerRight},${innerY} ${backRight},${backY} ${backX},${backY}" fill="#EEF3FA" stroke="#90A2BA" stroke-width="0.8" />
      <polygon points="${innerRight},${innerY} ${innerRight},${innerBottom} ${backRight},${backBottom} ${backRight},${backY}" fill="#E3EAF4" stroke="#90A2BA" stroke-width="0.8" />
      <polygon points="${innerX},${innerY} ${innerX},${innerBottom} ${backX},${backBottom} ${backX},${backY}" fill="#EAF0F8" stroke="#90A2BA" stroke-width="0.8" />
      <polygon points="${innerX},${innerBottom} ${innerRight},${innerBottom} ${backRight},${backBottom} ${backX},${backBottom}" fill="#E7EEF7" stroke="#90A2BA" stroke-width="0.8" />
      <rect x="${backX}" y="${backY}" width="${innerW}" height="${innerH}" fill="#F4F8FD" stroke="#91A4BC" stroke-width="0.8" />
      ${shelfGroups}
      <rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" fill="none" stroke="#5B6F88" stroke-width="0.95" />
      <polygon points="${topPoly}" fill="#D6DFEC" stroke="#64748B" stroke-width="1.1" />
      <rect x="${frontX}" y="${frontY}" width="${frontW}" height="${panelT}" fill="#E9EFF8" />
      <rect x="${frontX}" y="${frontY + panelT}" width="${panelT}" height="${Math.max(0, frontH - panelT * 2)}" fill="#E9EFF8" />
      <rect x="${rightX - panelT}" y="${frontY + panelT}" width="${panelT}" height="${Math.max(0, frontH - panelT * 2)}" fill="#E9EFF8" />
      <rect x="${frontX + panelT}" y="${bottomY - panelT}" width="${Math.max(0, frontW - panelT * 2)}" height="${panelT}" fill="#E9EFF8" />
      <polygon points="${sidePoly}" fill="#BFCBDD" stroke="#64748B" stroke-width="1.1" />
    </svg>
  `;
  return { svg, svgW, svgH };
}

async function cabinetSvgMarkupToPngDataUrl(svgMarkup: string, widthPx: number, heightPx: number): Promise<string> {
  if (typeof window === "undefined") return "";
  const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = (e) => reject(e);
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(widthPx));
    canvas.height = Math.max(1, Math.floor(heightPx));
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
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

function approximateTextWidthPx(value: string): number {
  const txt = String(value ?? "");
  return txt.length * 8;
}

function nestingPieceTooltip(mainName: string, subName: string, room: string, width: number, height: number): string {
  const hasSub = String(subName || "").trim() && String(mainName || "").trim() !== String(subName || "").trim();
  const partTitle = "Part:";
  const roomTitle = "Room:";
  const sizeTitle = "Size:";
  const main = String(mainName || subName || "Part").trim();
  const sub = String(subName || "").trim();
  const roomText = String(room || "-").trim() || "-";
  const sizeText = `${Math.round(width)} x ${Math.round(height)}`;
  const labelWidth = 6;
  const line = (label: string, value: string) => `${label.padEnd(labelWidth, " ")} ${value}`;
  const indent = " ".repeat(labelWidth + 1);
  const partLine = hasSub
    ? `${line(partTitle, main)}\n${indent}${sub}`
    : line(partTitle, main);
  const roomLine = line(roomTitle, roomText);
  const sizeLine = line(sizeTitle, sizeText);
  return `${partLine}\n${roomLine}\n${sizeLine}`;
}

function parseDerivedNestingRowId(rowId: string): { parentRowId: string; kind: "cab" | "drw" | null; subKey: string } {
  const cabToken = "__cab__";
  const drwToken = "__drw__";
  const cabIdx = rowId.indexOf(cabToken);
  if (cabIdx > 0) {
    return {
      parentRowId: rowId.slice(0, cabIdx),
      kind: "cab",
      subKey: rowId.slice(cabIdx + cabToken.length),
    };
  }
  const drwIdx = rowId.indexOf(drwToken);
  if (drwIdx > 0) {
    return {
      parentRowId: rowId.slice(0, drwIdx),
      kind: "drw",
      subKey: rowId.slice(drwIdx + drwToken.length),
    };
  }
  return { parentRowId: rowId, kind: null, subKey: "" };
}

function autoClashByDominant(primary: number, secondary: number): { clashLeft: string; clashRight: string } {
  if (!Number.isFinite(primary) || !Number.isFinite(secondary) || primary <= 0 || secondary <= 0) {
    return { clashLeft: "", clashRight: "" };
  }
  return primary > secondary ? { clashLeft: "1L", clashRight: "" } : { clashLeft: "", clashRight: "1S" };
}

function normalizeMmOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => String(v ?? "").replace(/mm$/i, "").trim())
    .filter(Boolean);
}

function normalizeBoardFinishes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v ?? "").trim()).filter(Boolean);
}

function normalizeSheetSizes(raw: unknown): SheetSizeOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Record<string, unknown>;
      const h = toStr(item.h ?? item.height);
      const w = toStr(item.w ?? item.width);
      const isDefault = Boolean(item.isDefault ?? item.default);
      return { h, w, isDefault };
    })
    .filter((row) => row.h && row.w);
}

function normalizeDrawerTypes(raw: unknown): HardwareDrawerType[] {
  if (!Array.isArray(raw)) return [];
  const out: HardwareDrawerType[] = [];
  const extractDrawerHeightLabel = (value: unknown): string => {
    if (value == null) return "";
    const rawText =
      typeof value === "string"
        ? value
        : toStr(
            (value as Record<string, unknown>)?.letter ??
            (value as Record<string, unknown>)?.label ??
            (value as Record<string, unknown>)?.code ??
            (value as Record<string, unknown>)?.name ??
            (value as Record<string, unknown>)?.value,
          );
    const raw = toStr(rawText);
    if (!raw) return "";
    const withoutTrailingNumber = raw.replace(/\s*\d+(\.\d+)?\s*$/g, "").trim();
    const cleaned = withoutTrailingNumber.replace(/[:|,\-]+$/g, "").trim();
    return cleaned || raw;
  };
  const extractDrawerHeightValue = (value: unknown, label: string): string => {
    if (value == null) return "";
    if (typeof value === "string") {
      const raw = toStr(value);
      if (!raw) return "";
      const prefix = String(label || "").trim();
      if (!prefix) return "";
      const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const remaining = raw.replace(new RegExp(`^\\s*${escaped}\\s*`, "i"), "").trim();
      return remaining;
    }
    return toStr(
      (value as Record<string, unknown>)?.value ??
      (value as Record<string, unknown>)?.height ??
      (value as Record<string, unknown>)?.mm ??
      (value as Record<string, unknown>)?.size,
    );
  };
  for (const row of raw) {
    if (typeof row === "string") {
      const name = row.trim();
      if (name) {
        out.push({
          name,
          isDefault: false,
          heightLetters: [],
          heightOptions: [],
          bottomsWidthMinus: null,
          bottomsDepthMinus: null,
          backsWidthMinus: null,
          hardwareLengths: [],
          spaceRequirement: null,
        });
      }
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const name = toStr(item.name ?? item.type ?? item.label);
    if (!name) continue;
    const bottoms = item.bottoms && typeof item.bottoms === "object" ? (item.bottoms as Record<string, unknown>) : {};
    const backs = item.backs && typeof item.backs === "object" ? (item.backs as Record<string, unknown>) : {};
    const heightRows = Array.isArray(backs.heights)
      ? backs.heights
      : Array.isArray(backs.letters)
        ? backs.letters
        : [];
    const heightLetters: string[] = [];
    const heightOptions: DrawerHeightOption[] = [];
    const seen = new Set<string>();
    for (const rawHeight of heightRows) {
      const label = extractDrawerHeightLabel(rawHeight);
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      heightLetters.push(label);
      const value = extractDrawerHeightValue(rawHeight, label);
      heightOptions.push({ token: label, value });
    }
    const bottomsWidthMinus = toNum(bottoms.widthMinus ?? item.widthMinus);
    const bottomsDepthMinus = toNum(bottoms.depthMinus ?? item.depthMinus);
    const backsWidthMinus = toNum(backs.widthMinus);
    const hardwareLengths = Array.isArray(item.hardwareLengths)
      ? (item.hardwareLengths as unknown[])
          .map((v) => toNum(v))
          .filter((v) => Number.isFinite(v) && v > 0)
      : [];
    const spaceParsed = toNum(item.spaceRequirement ?? item.clearance);
    const spaceRequirement = Number.isFinite(spaceParsed) && spaceParsed > 0 ? spaceParsed : null;
    out.push({
      name,
      isDefault: Boolean(item.default ?? item.isDefault),
      heightLetters,
      heightOptions,
      bottomsWidthMinus: bottomsWidthMinus > 0 ? bottomsWidthMinus : null,
      bottomsDepthMinus: bottomsDepthMinus > 0 ? bottomsDepthMinus : null,
      backsWidthMinus: backsWidthMinus > 0 ? backsWidthMinus : null,
      hardwareLengths,
      spaceRequirement,
    });
  }
  return out;
}

function normalizeHardwareRows(raw: unknown): HardwareTypeRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Record<string, unknown>;
      const name = toStr(item.name);
      const hingesRaw = Array.isArray(item.hinges) ? item.hinges : [];
      const hinges = hingesRaw
        .map((entry) => {
          if (typeof entry === "string") return entry.trim();
          if (entry && typeof entry === "object") {
            return toStr((entry as Record<string, unknown>).name ?? (entry as Record<string, unknown>).label);
          }
          return "";
        })
        .filter(Boolean);
      const otherRaw = Array.isArray(item.other) ? item.other : [];
      const other = otherRaw
        .map((entry) => {
          if (typeof entry === "string") return entry.trim();
          if (entry && typeof entry === "object") {
            return toStr((entry as Record<string, unknown>).name ?? (entry as Record<string, unknown>).label);
          }
          return "";
        })
        .filter(Boolean);
      return {
        name,
        isDefault: Boolean(item.default),
        drawers: normalizeDrawerTypes(item.drawers),
        hinges,
        other,
      };
    })
    .filter((row) => row.name);
}

function normalizeBoardColourMemory(raw: unknown): BoardColourMemoryRow[] {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const colours = Array.isArray(obj.colours) ? obj.colours : [];
    return colours
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          value: toStr(item.value),
          count: Number(item.count ?? 0),
        };
      })
      .filter((row) => row.value)
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }

  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        value: toStr(item.value ?? item.colour ?? item.color),
        count: Number(item.count ?? 0),
      };
    })
    .filter((row) => row.value)
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function normalizeHexColor(input: unknown): string | null {
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

function hexToRgba(hex: string, alpha: number): string {
  const safe = normalizeHexColor(hex) ?? "#94A3B8";
  const r = Number.parseInt(safe.slice(1, 3), 16);
  const g = Number.parseInt(safe.slice(3, 5), 16);
  const b = Number.parseInt(safe.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isLightHex(hex: string): boolean {
  const safe = normalizeHexColor(hex) ?? "#94A3B8";
  const r = Number.parseInt(safe.slice(1, 3), 16);
  const g = Number.parseInt(safe.slice(3, 5), 16);
  const b = Number.parseInt(safe.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62;
}

function darkenHex(hex: string, amount: number): string {
  const safe = normalizeHexColor(hex) ?? "#94A3B8";
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

function lightenHex(hex: string, amount: number): string {
  const safe = normalizeHexColor(hex) ?? "#94A3B8";
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

function groupColorPalette(baseColor: string) {
  const light = isLightHex(baseColor);
  return {
    text: light ? "#000000" : "#FFFFFF",
    titleBarBg: light ? lightenHex(baseColor, 0.3) : lightenHex(baseColor, 0.08),
    headerBg: light ? lightenHex(baseColor, 0.22) : darkenHex(baseColor, 0.06),
    rowBg: light ? lightenHex(baseColor, 0.34) : lightenHex(baseColor, 0.12),
    divider: baseColor,
    titleChipBg: baseColor,
    titleChipBorder: darkenHex(baseColor, light ? 0.18 : 0.1),
  };
}

const CLASH_LEFT_OPTIONS = ["1L", "2L"] as const;
const CLASH_RIGHT_OPTIONS = ["1S", "2S"] as const;
const DRILLING_OPTIONS = ["No", "Even Spacing", "Centre"] as const;

function splitClashing(raw: string): { left: string; right: string } {
  const upper = String(raw || "").toUpperCase();
  const left = CLASH_LEFT_OPTIONS.find((v) => upper.includes(v)) ?? "";
  let right = CLASH_RIGHT_OPTIONS.find((v) => upper.includes(v)) ?? "";
  if (!right && upper.includes("2SH")) right = "2S";
  return { left, right };
}

function joinClashing(left: string, right: string): string {
  return [String(left || "").trim(), String(right || "").trim()].filter(Boolean).join(" ");
}

function normalizeDrillingValue(value: unknown): "No" | "Even Spacing" | "Centre" {
  const txt = String(value ?? "").trim().toLowerCase();
  if (["even spacing", "even", "spacing", "equal spacing", "evenly spaced", "even-spaced"].includes(txt)) {
    return "Even Spacing";
  }
  if (["centre", "center", "centred", "centered"].includes(txt)) {
    return "Centre";
  }
  return "No";
}

function DrillingArrowIcon({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block"
      style={{
        width: 9,
        height: 9,
        backgroundColor: color || "#0F172A",
        WebkitMaskImage: "url('/arrow.png')",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        WebkitMaskSize: "contain",
        maskImage: "url('/arrow.png')",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        maskSize: "contain",
      }}
    />
  );
}

function parseDrawerHeightTokens(value: string): string[] {
  const txt = String(value || "").trim();
  if (!txt) return [];
  return txt
    .split(/[,+/\\\s]+/)
    .map((t) => t.trim())
    .map((t) => (["nan", "undefined", "null"].includes(t.toLowerCase()) ? "" : t))
    .filter(Boolean);
}

function formatDrawerHeightTokens(values: string[]): string {
  return values
    .map((v) => String(v || "").trim().replace(/,+$/g, ""))
    .filter(Boolean)
    .join(", ");
}

function summarizeDrawerHeightTokens(value: string): string {
  const tokens = parseDrawerHeightTokens(value);
  if (!tokens.length) return "";
  const order: string[] = [];
  const labelsByKey = new Map<string, string>();
  const countsByKey = new Map<string, number>();
  for (const token of tokens) {
    const label = String(token || "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (!labelsByKey.has(key)) {
      labelsByKey.set(key, label);
      order.push(key);
    }
    countsByKey.set(key, (countsByKey.get(key) ?? 0) + 1);
  }
  return order
    .map((key) => {
      const label = labelsByKey.get(key) ?? key;
      const count = countsByKey.get(key) ?? 0;
      return count > 1 ? `${label} (x${count})` : label;
    })
    .join(", ");
}

function informationLinesFromValue(value: string): string[] {
  const lines = String(value ?? "")
    .replace(/\r/g, "")
    .split("\n");
  return lines.length ? lines : [""];
}

function informationValueFromLines(lines: string[]): string {
  return [...lines].join("\n");
}

function normalizeProjectTagUsage(raw: unknown): Array<{ value: string; count: number }> {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const tags = Array.isArray(obj.tags) ? obj.tags : [];
  const out: Array<{ value: string; count: number }> = [];
  for (const row of tags) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const value = String(item.value ?? "").trim();
    const count = Number(item.count ?? 0);
    if (!value) continue;
    out.push({ value, count: Number.isFinite(count) ? count : 0 });
  }
  return out.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

type DrawerHeightDropdownProps = {
  value: string;
  options: string[];
  disabled?: boolean;
  bg: string;
  border: string;
  text: string;
  className?: string;
  title?: string;
  compact?: boolean;
  onAdd: (token: string) => void;
  onRemove: (token: string) => void;
  onOpenChange?: (open: boolean) => void;
};

function DrawerHeightDropdown({
  value,
  options,
  disabled,
  bg,
  border,
  text,
  className,
  title,
  compact,
  onAdd,
  onRemove,
  onOpenChange,
}: DrawerHeightDropdownProps) {
  const [open, setOpen] = useState(false);
  const [hoverExpand, setHoverExpand] = useState(false);
  const [hoverRect, setHoverRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!hostRef.current) return;
      if (!hostRef.current.contains(e.target as Node)) {
        setOpen(false);
        onOpenChange?.(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open, onOpenChange]);

  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const tok of parseDrawerHeightTokens(value)) {
      const k = tok.toLowerCase();
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    return out;
  }, [value]);

  const heightCls = compact ? "h-6 text-[11px]" : "h-8 text-[12px]";
  const summaryValue = summarizeDrawerHeightTokens(String(value || ""));
  const displayValue = summaryValue || String(value || "").trim() || "\u00A0";
  const hoverPreview = summaryValue || String(value || "").trim();
  const showHoverPreview = hoverPreview.length > 0 && isOverflowing;
  const shouldExpand = showHoverPreview && hoverExpand && !open;

  const updateHoverRect = () => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setHoverRect({ left: r.left, top: r.top, width: r.width, height: r.height });
  };

  const updateOverflowState = () => {
    if (!labelRef.current) {
      setIsOverflowing(false);
      return;
    }
    const el = labelRef.current;
    setIsOverflowing(el.scrollWidth > el.clientWidth + 1);
  };

  useEffect(() => {
    updateOverflowState();
  }, [hoverPreview]);

  useEffect(() => {
    if (!shouldExpand || !buttonRef.current) return;
    updateHoverRect();
    window.addEventListener("scroll", updateHoverRect, true);
    window.addEventListener("resize", updateHoverRect);
    return () => {
      window.removeEventListener("scroll", updateHoverRect, true);
      window.removeEventListener("resize", updateHoverRect);
    };
  }, [shouldExpand]);

  return (
    <div ref={hostRef} className={`relative w-full min-w-0 overflow-visible ${open ? "z-[2147483646]" : ""}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onMouseEnter={() => {
          setHoverExpand(true);
          updateOverflowState();
          updateHoverRect();
        }}
        onMouseLeave={() => setHoverExpand(false)}
        onClick={() => {
          const next = !open;
          setOpen(next);
          onOpenChange?.(next);
        }}
        title={title}
        className={`${heightCls} inline-flex w-full items-center justify-between rounded-[8px] border px-2 text-left transition-all duration-150 disabled:opacity-70 ${className ?? ""}`}
        style={{
          backgroundColor: bg,
          borderColor: border,
          color: text,
        }}
      >
        <span ref={labelRef} className="min-w-0 flex-1 truncate leading-[1]">{displayValue}</span>
        <ChevronDown size={compact ? 13 : 14} className="ml-2 shrink-0 self-center" />
      </button>
      {shouldExpand && hoverRect && (
        <div
          className={`${heightCls} pointer-events-none fixed z-[1000] inline-flex items-center justify-between rounded-[8px] border px-2 text-left`}
          style={{
            left: hoverRect.left,
            top: hoverRect.top,
            minWidth: hoverRect.width,
            width: "max-content",
            maxWidth: 420,
            height: hoverRect.height,
            backgroundColor: bg,
            borderColor: border,
            color: text,
            boxShadow: "0 8px 24px rgba(15,23,42,0.16)",
          }}
        >
          <span className="whitespace-nowrap pr-2">{hoverPreview}</span>
          <ChevronDown size={compact ? 13 : 14} className="ml-2 shrink-0 self-center" />
        </div>
      )}
      {open && !disabled && (
        <div className="absolute left-0 top-[calc(100%+2px)] z-[2147483647] min-w-[220px] rounded-[8px] border border-[#D9DEE8] bg-white p-1 shadow-[0_10px_30px_rgba(15,23,42,0.12)]">
          {options.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-[#64748B]">No heights configured</p>
          ) : (
            <div className="space-y-[2px]">
              {options.map((opt) => {
                const count = counts.get(opt.toLowerCase()) ?? 0;
                return (
                  <div key={opt} className="grid grid-cols-[30px_minmax(96px,1fr)_24px_24px] items-center gap-1 rounded-[6px] px-1 py-[2px] hover:bg-[#F8FAFC]">
                    <span className="text-center text-[10px] font-bold text-[#475569]">{count}</span>
                    <span className="truncate text-[11px] font-semibold text-[#0F172A]">{opt}</span>
                    <button
                      type="button"
                      onClick={() => onAdd(opt)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] border border-[#A9DDBF] bg-[#EAF8F0] text-[12px] font-bold leading-none text-[#1F8A4C] hover:bg-[#DDF2E7]"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      disabled={count <= 0}
                      onClick={() => onRemove(opt)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828] disabled:opacity-45"
                    >
                      <X size={11} strokeWidth={2.8} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type BoardPillDropdownProps = {
  value: string;
  options: readonly string[];
  disabled?: boolean;
  bg: string;
  border: string;
  text: string;
  size?: "default" | "compact";
  className?: string;
  title?: string;
  matchDrawerArrow?: boolean;
  getSize: (value: string) => string;
  getLabel: (value: string) => string;
  onChange: (value: string) => void;
};

type PartNameSuggestionOption = {
  name: string;
  partType: string;
  color: string;
  textColor: string;
};

type CompactPlainDropdownProps = {
  value: string;
  options: readonly string[];
  disabled?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
};

function CompactPlainDropdown({
  value,
  options,
  disabled,
  onChange,
  placeholder = "",
}: CompactPlainDropdownProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const refreshRect = () => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 2, width: r.width });
  };

  useEffect(() => {
    if (!open) return;
    refreshRect();
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const inHost = Boolean(hostRef.current?.contains(target));
      const inMenu = Boolean(menuRef.current?.contains(target));
      if (!inHost && !inMenu) setOpen(false);
    };
    const onWin = () => refreshRect();
    document.addEventListener("mousedown", onDocDown);
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [open]);

  const selected = String(value ?? "").trim();

  return (
    <div ref={hostRef} data-cutlist-clash-dropdown="1" className="relative z-[60] pointer-events-auto">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto h-6 w-full rounded-[4px] border border-[#94A3B8] bg-white px-1 pr-5 text-left text-[11px] text-[#0F172A] disabled:opacity-70"
      >
        <span className="truncate">{selected || placeholder}</span>
        <ChevronDown size={12} className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[#0F172A]" />
      </button>
      {open && rect && !disabled && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 pointer-events-auto" style={{ zIndex: 2147483647 }}>
          <div
            ref={menuRef}
            data-cutlist-clash-dropdown="1"
            className="pointer-events-auto fixed max-h-[220px] overflow-auto rounded-[8px] border border-[#D9DEE8] bg-white p-1 shadow-[0_10px_30px_rgba(15,23,42,0.12)]"
            style={{ left: rect.left, top: rect.top, width: rect.width, zIndex: 2147483647 }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="flex h-6 w-full items-center rounded-[5px] px-1 text-left text-[11px] text-[#64748B] hover:bg-[#F8FAFC]"
            >
              <span className="truncate"></span>
            </button>
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className="flex h-6 w-full items-center rounded-[5px] px-1 text-left text-[11px] text-[#0F172A] hover:bg-[#F8FAFC]"
              >
                <span className="truncate">{opt}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function hasShelfQuantity(value: unknown): boolean {
  const text = String(value ?? "").trim();
  if (!text) return false;
  const numeric = Number.parseFloat(text);
  return Number.isFinite(numeric) && numeric >= 1;
}

function numericOnlyText(value: unknown): string {
  return String(value ?? "").replace(/[^\d]/g, "");
}

function isNumericCutlistInputKey(key: string): boolean {
  return key === "height" || key === "width" || key === "depth" || key === "quantity";
}

function BoardPillDropdown({
  value,
  options,
  disabled,
  bg,
  border,
  text,
  size = "default",
  className,
  title,
  matchDrawerArrow = false,
  getSize,
  getLabel,
  onChange,
}: BoardPillDropdownProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const refreshRect = () => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 2, width: r.width });
  };

  useEffect(() => {
    if (!open) return;
    refreshRect();
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const inHost = Boolean(hostRef.current?.contains(target));
      const inMenu = Boolean(menuRef.current?.contains(target));
      if (!inHost && !inMenu) setOpen(false);
    };
    const onWin = () => refreshRect();
    document.addEventListener("mousedown", onDocDown);
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [open]);

  const selectedSize = getSize(value);
  const selectedLabel = getLabel(value);
  const compact = size === "compact";

  return (
    <div ref={hostRef} className="relative z-[60] pointer-events-auto">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        title={title}
        onClick={() => setOpen((v) => !v)}
        className={`pointer-events-auto relative w-full border text-left disabled:opacity-70 ${compact ? "h-6 rounded-[4px] px-1 text-[11px]" : "h-8 rounded-[8px] px-2 text-[12px]"} ${className ?? ""}`}
        style={{ backgroundColor: bg, borderColor: border, color: text }}
      >
        {compact ? (
          <>
            <span className={`inline-flex w-full min-w-0 items-center ${matchDrawerArrow ? "" : "pr-4"}`}>
              <span className="inline-flex min-w-0 items-center gap-2">
                {!!selectedSize && (
                  <span
                    className="inline-flex h-4 min-w-[24px] items-center justify-center rounded-[999px] px-1.5 text-[9px] font-bold"
                    style={{ backgroundColor: darkenHex(bg, 0.15), color: text }}
                  >
                    {selectedSize}
                  </span>
                )}
                <span className="truncate">{selectedLabel}</span>
              </span>
            </span>
            <ChevronDown
              size={12}
              className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2"
            />
          </>
        ) : (
          <span className="inline-flex w-full items-center gap-2 pr-5">
            <span className="inline-flex min-w-0 items-center gap-2">
              {!!selectedSize && (
                <span
                  className="inline-flex h-5 min-w-[28px] items-center justify-center rounded-[999px] px-2 text-[10px] font-bold"
                  style={{ backgroundColor: darkenHex(bg, 0.15), color: text }}
                >
                  {selectedSize}
                </span>
              )}
              <span className="truncate">{selectedLabel}</span>
            </span>
            <ChevronDown size={14} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2" />
          </span>
        )}
      </button>
      {open && rect && !disabled && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 pointer-events-auto" style={{ zIndex: 2147483647 }}>
          <div
            ref={menuRef}
            className={`pointer-events-auto fixed overflow-auto border border-[#D9DEE8] bg-white p-1 shadow-[0_10px_30px_rgba(15,23,42,0.12)] ${compact ? "max-h-[240px] rounded-[8px]" : "max-h-[280px] rounded-[8px]"}`}
            style={{ left: rect.left, top: rect.top, width: rect.width, zIndex: 2147483647 }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className={`flex w-full items-center text-left text-[#64748B] hover:bg-[#F8FAFC] ${compact ? "h-6 rounded-[5px] px-1 text-[11px]" : "h-8 rounded-[6px] px-2 text-[12px]"}`}
            >
              <span className="truncate"></span>
            </button>
            {options.map((opt) => {
              const sz = getSize(opt);
              const lb = getLabel(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                    onClick={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                   className={`flex w-full items-center text-left text-[#0F172A] hover:bg-[#F8FAFC] ${compact ? "h-6 rounded-[5px] px-1 text-[11px]" : "h-8 rounded-[6px] px-2 text-[12px]"}`}
                >
                  <span className="inline-flex min-w-0 items-center gap-2">
                  {!!sz && (
                    <span className={`inline-flex items-center justify-center rounded-[999px] bg-[#B6C3D4] font-bold text-[#0F172A] ${compact ? "h-4 min-w-[24px] px-1.5 text-[9px]" : "h-5 min-w-[28px] px-2 text-[10px]"}`}>
                      {sz}
                    </span>
                  )}
                    <span className="truncate">{lb}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

type PartNameSuggestionInputProps = {
  value: string;
  options: readonly PartNameSuggestionOption[];
  disabled?: boolean;
  autoFocus?: boolean;
  title?: string;
  containerStyle?: React.CSSProperties;
  className?: string;
  style?: React.CSSProperties;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onCommit?: () => void;
  onCancel?: () => void;
};

function PartNameSuggestionInput({
  value,
  options,
  disabled,
  autoFocus,
  title,
  containerStyle,
  className,
  style,
  onChange,
  onBlur,
  onCommit,
  onCancel,
}: PartNameSuggestionInputProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const blurTimeoutRef = useRef<number | null>(null);

  const refreshRect = () => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 2, width: r.width });
  };

  const filteredOptions = useMemo(() => {
    const normalizedValue = String(value ?? "").trim().toLowerCase();
    if (!normalizedValue) return options.slice(0, 10);
    const starts = options.filter((option) => option.name.toLowerCase().startsWith(normalizedValue));
    const contains = options.filter(
      (option) =>
        !option.name.toLowerCase().startsWith(normalizedValue) &&
        option.name.toLowerCase().includes(normalizedValue),
    );
    return [...starts, ...contains].slice(0, 10);
  }, [options, value]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current != null) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshRect();
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const inHost = Boolean(hostRef.current?.contains(target));
      const inMenu = Boolean(menuRef.current?.contains(target));
      if (!inHost && !inMenu) {
        setOpen(false);
      }
    };
    const onWin = () => refreshRect();
    document.addEventListener("mousedown", onDocDown);
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [open]);

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  const hoverColorForOption = (color: string) => (isLightHex(color) ? darkenHex(color, 0.08) : lightenHex(color, 0.08));

  return (
    <div ref={hostRef} className="relative w-full min-w-0" style={containerStyle}>
      <input
        ref={inputRef}
        disabled={disabled}
        autoFocus={autoFocus}
        title={title}
        value={value}
        onFocus={() => {
          if (blurTimeoutRef.current != null) {
            window.clearTimeout(blurTimeoutRef.current);
            blurTimeoutRef.current = null;
          }
          if (filteredOptions.length > 0) {
            setOpen(true);
            refreshRect();
          }
        }}
        onChange={(e) => {
          onChange(e.target.value);
          if (!open) setOpen(true);
        }}
        onBlur={() => {
          blurTimeoutRef.current = window.setTimeout(() => {
            setOpen(false);
            onBlur?.();
          }, 120);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            setOpen(false);
            onCommit?.();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            onCancel?.();
          }
        }}
        className={`w-full min-w-0 ${className ?? ""}`}
        style={style}
      />
      {open && filteredOptions.length > 0 && rect && !disabled && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 pointer-events-auto" style={{ zIndex: 2147483647 }}>
          <div
            ref={menuRef}
            className="pointer-events-auto fixed max-h-[240px] overflow-auto rounded-[10px] border border-[#D9DEE8] bg-white p-1 shadow-[0_10px_30px_rgba(15,23,42,0.12)]"
            style={{ left: rect.left, top: rect.top, width: rect.width, zIndex: 2147483647 }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {filteredOptions.map((option) => (
              <button
                key={`${option.partType}_${option.name}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (blurTimeoutRef.current != null) {
                    window.clearTimeout(blurTimeoutRef.current);
                    blurTimeoutRef.current = null;
                  }
                  selectOption(option.name);
                }}
                className="flex h-8 w-full items-center rounded-[8px] border px-2 text-left transition-colors"
                style={{
                  backgroundColor: lightenHex(option.color, 0.14),
                  borderColor: darkenHex(option.color, 0.18),
                  color: option.textColor,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = hoverColorForOption(option.color);
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = lightenHex(option.color, 0.14);
                }}
              >
                <span className="inline-flex w-full min-w-0 items-center text-[11px] font-semibold">
                  <span className="truncate">{option.name}</span>
                </span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function normalizeSalesRooms(raw: unknown): SalesRoomRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SalesRoomRow[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const item = (row ?? {}) as Record<string, unknown>;
    const name = String((typeof row === "string" ? row : item.name) ?? "").trim();
    const key = name.toLowerCase();
    if (!name || key === "all" || seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      included: typeof row === "string" ? true : Boolean(item.included ?? true),
      totalPrice: typeof row === "string" ? "0.00" : String(item.totalPrice ?? "0.00"),
    });
  }
  return out;
}

function normalizeSalesProducts(raw: unknown): SalesProductRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SalesProductRow[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const item = (row ?? {}) as Record<string, unknown>;
    const name = String((typeof row === "string" ? row : item.name) ?? "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      selected:
        typeof row === "string"
          ? true
          : Boolean(
              item.selected ??
                item.included ??
                item.checked ??
                item.enabled ??
                item.active ??
                item.tick ??
                false,
            ),
    });
  }
  return out;
}

function serializeCutlistRowsForStorage(
  rows: CutlistRow[],
  isCabinetryPartTypeFn: (partType: string) => boolean,
) {
  return rows.map((row, idx) => {
    const isCabinetry = isCabinetryPartTypeFn(row.partType);
    return {
      __id: idx + 1,
      __cutlist_key: row.id,
      Room: row.room,
      partType: row.partType,
      Board: row.board,
      Name: row.name,
      Height: row.height,
      Width: row.width,
      Depth: row.depth,
      Quantity: row.quantity,
      Clashing: isCabinetry
        ? ""
        : joinClashing(String(row.clashLeft ?? ""), String(row.clashRight ?? "")) || row.clashing,
      fixedShelf: isCabinetry ? String(row.fixedShelf ?? "") : "",
      adjustableShelf: isCabinetry ? String(row.adjustableShelf ?? "") : "",
      fixedShelfDrilling: isCabinetry ? normalizeDrillingValue(row.fixedShelfDrilling) : "No",
      adjustableShelfDrilling: isCabinetry ? normalizeDrillingValue(row.adjustableShelfDrilling) : "No",
      Information: row.information,
      Grain: String(row.grainValue || (row.grain ? "Yes" : "")),
      includeInNesting: row.includeInNesting !== false,
    };
  });
}

function normalizeCompanySalesProducts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const name = String(item.name ?? "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    const showInSales = Boolean(item.showInSales ?? true);
    if (!showInSales) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export default function ProjectDetailsPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [changes, setChanges] = useState<ProjectChange[]>([]);
  const [quotes, setQuotes] = useState<SalesQuote[]>([]);
  const [projectImageUrls, setProjectImageUrls] = useState<string[]>([]);
  const [selectedProjectImageIndex, setSelectedProjectImageIndex] = useState(0);
  const [isUploadingProjectImages, setIsUploadingProjectImages] = useState(false);
  const [projectImageUploadProgress, setProjectImageUploadProgress] = useState(0);
  const [isDeletingProjectImage, setIsDeletingProjectImage] = useState(false);
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [quoteProjectTextDrafts, setQuoteProjectTextDrafts] = useState<Record<string, string>>({});
  const [isSavingQuoteProjectText, setIsSavingQuoteProjectText] = useState(false);
  const quoteProjectTextRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const quoteProjectTextToolbarRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const quotePrintSheetRef = useRef<HTMLDivElement | null>(null);
  const quoteContainerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const quotePreviewPageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const quotePreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const [quoteProjectTextPagination, setQuoteProjectTextPagination] = useState<{ blockId: string; chunks: string[] } | null>(null);
  const [quoteContainerPagination, setQuoteContainerPagination] = useState<{ pageContainerIds: string[][] } | null>(null);
  const [activeQuotePreviewPageId, setActiveQuotePreviewPageId] = useState("quote_page_1");
  const [quoteProjectTextPreviewMode, setQuoteProjectTextPreviewMode] = useState<{
    blockId: string;
    mode: "single" | "textSplit" | "trailingOnly";
  } | null>(null);
  const [activeQuoteProjectTextEditBlockId, setActiveQuoteProjectTextEditBlockId] = useState<string | null>(null);
  const [quoteProjectTextMetrics, setQuoteProjectTextMetrics] = useState<{
    blockId: string;
    pageHeight: number;
    firstTextTop: number;
    topHeight: number;
    beforeHeight: number;
    afterHeight: number;
    bottomHeight: number;
    overheadFirst: number;
    overheadContinuation: number;
    totalSinglePageOverflow: number;
    textOnlyOverflow: number;
  } | null>(null);
  const [selectedProjectFileIndex, setSelectedProjectFileIndex] = useState(0);
  const [selectedProjectFileIds, setSelectedProjectFileIds] = useState<string[]>([]);
  const [openProjectFilePreviewId, setOpenProjectFilePreviewId] = useState("");
  const [isUploadingProjectFiles, setIsUploadingProjectFiles] = useState(false);
  const [projectFileUploadProgress, setProjectFileUploadProgress] = useState(0);
  const [isDeletingProjectFile, setIsDeletingProjectFile] = useState(false);
  const [isEditingClientDetails, setIsEditingClientDetails] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesParagraphMode, setNotesParagraphMode] = useState(false);
  const [notesBulletMode, setNotesBulletMode] = useState(false);
  const [notesBoldActive, setNotesBoldActive] = useState(false);
  const [notesItalicActive, setNotesItalicActive] = useState(false);
  const [notesStrikeActive, setNotesStrikeActive] = useState(false);
  const [isSavingGeneralDetails, setIsSavingGeneralDetails] = useState(false);
  const [generalDetailsDraft, setGeneralDetailsDraft] = useState({
    customer: "",
    clientPhone: "",
    clientEmail: "",
    clientAddress: "",
    notes: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [projectStatusMenuPos, setProjectStatusMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [projectTags, setProjectTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isTagInputOpen, setIsTagInputOpen] = useState(false);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [activeBoardColourSuggestionsRowId, setActiveBoardColourSuggestionsRowId] = useState<string | null>(null);
  const [isSavingSalesRooms, setIsSavingSalesRooms] = useState(false);
  const [editingSalesRoomName, setEditingSalesRoomName] = useState("");
  const [editingSalesRoomDraftName, setEditingSalesRoomDraftName] = useState("");
  const [salesRoomDeleteBlocked, setSalesRoomDeleteBlocked] = useState<{ roomName: string } | null>(null);
  const [isAddRoomModalOpen, setIsAddRoomModalOpen] = useState(false);
  const [addRoomName, setAddRoomName] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [lockMessage, setLockMessage] = useState("");
  const [unlockHours, setUnlockHours] = useState<number>(6);
  const [unlockTick, setUnlockTick] = useState(0);
  const [isGrantingUnlock, setIsGrantingUnlock] = useState(false);
  const [unlockMembers, setUnlockMembers] = useState<CompanyMemberOption[]>([]);
  const [companyMembers, setCompanyMembers] = useState<CompanyMemberOption[]>([]);
  const [unlockTargetUid, setUnlockTargetUid] = useState("");
  const [companyAccess, setCompanyAccess] = useState<CompanyAccessInfo | null>(null);
  const [companyDoc, setCompanyDoc] = useState<Record<string, unknown> | null>(null);
  const [salesNav, setSalesNav] = useState<SalesNav>("initial");
  const [productionNav, setProductionNav] = useState<ProductionNav>("overview");
  const [nestingFullscreen, setNestingFullscreen] = useState(false);
  const boardColourEditStartRef = useRef<Record<string, string>>({});
  const [productionCutlist, setProductionCutlist] = useState<Cutlist | null>(null);
  const [cutlistRows, setCutlistRows] = useState<CutlistRow[]>([]);
  const [cutlistSearch, setCutlistSearch] = useState("");
  const [cutlistPartTypeFilter, setCutlistPartTypeFilter] = useState("All Part Types");
  const [cutlistRoomFilter, setCutlistRoomFilter] = useState("Project Cutlist");
  const [initialCutlistRows, setInitialCutlistRows] = useState<CutlistRow[]>([]);
  const [initialCutlistSearch, setInitialCutlistSearch] = useState("");
  const [initialCutlistPartTypeFilter, setInitialCutlistPartTypeFilter] = useState("All Part Types");
  const [initialCutlistRoomFilter, setInitialCutlistRoomFilter] = useState("Project Cutlist");
  const [initialCutlistEntryRoom, setInitialCutlistEntryRoom] = useState("Project Cutlist");
  const [initialCutlistEntry, setInitialCutlistEntry] = useState<Omit<CutlistRow, "id" | "room">>(createEmptyCutlistEntry());
  const [initialActiveCutlistPartType, setInitialActiveCutlistPartType] = useState("");
  const [initialCutlistDraftRows, setInitialCutlistDraftRows] = useState<CutlistDraftRow[]>([]);
  const [initialCutlistDraftInitialized, setInitialCutlistDraftInitialized] = useState(false);
  const [cncSearch, setCncSearch] = useState("");
  const [cncPartTypeFilter, setCncPartTypeFilter] = useState("All Part Types");
  const [cncExportMenuOpen, setCncExportMenuOpen] = useState(false);
  const [cncVisibilitySearch, setCncVisibilitySearch] = useState("");
  const [cncCollapsedGroups, setCncCollapsedGroups] = useState<Record<string, boolean>>({});
  const [cncVisibilityMap, setCncVisibilityMap] = useState<Record<string, boolean>>({});
  const [nestingSearch, setNestingSearch] = useState("");
  const [nestingSheetPreview, setNestingSheetPreview] = useState<{ boardKey: string; sheetIndex: number } | null>(null);
  const [nestingPreviewHoverPieceId, setNestingPreviewHoverPieceId] = useState<string | null>(null);
  const [nestingTooltip, setNestingTooltip] = useState<null | {
    text: string;
    x: number;
    y: number;
    bg: string;
    border: string;
    textColor: string;
  }>(null);
  const [nestingVisibilityMap, setNestingVisibilityMap] = useState<Record<string, boolean>>({});
  const [nestingCollapsedGroups, setNestingCollapsedGroups] = useState<Record<string, boolean>>({});
  const [cutlistEntryRoom, setCutlistEntryRoom] = useState("Project Cutlist");
  const [cutlistEntry, setCutlistEntry] = useState<Omit<CutlistRow, "id" | "room">>(createEmptyCutlistEntry());
  const [activeCutlistPartType, setActiveCutlistPartType] = useState("");
  const [cutlistDraftRows, setCutlistDraftRows] = useState<CutlistDraftRow[]>([]);
  const [cutlistDraftInitialized, setCutlistDraftInitialized] = useState(false);
  const [cutlistCellWarnings, setCutlistCellWarnings] = useState<Record<string, Record<string, string>>>({});
  const [cutlistFlashingCells, setCutlistFlashingCells] = useState<Record<string, boolean>>({});
  const [cutlistActivityFeed, setCutlistActivityFeed] = useState<CutlistActivityEntry[]>([]);
  const [cutlistActivityEnteringIds, setCutlistActivityEnteringIds] = useState<Record<number, boolean>>({});
  const [cutlistFlashPhaseOn, setCutlistFlashPhaseOn] = useState(false);
  const cutlistFlashTimeoutRef = useRef<number | null>(null);
  const cutlistFlashIntervalRef = useRef<number | null>(null);
  const cutlistActivityScrollRef = useRef<HTMLDivElement | null>(null);
  const cutlistActivityInnerRef = useRef<HTMLDivElement | null>(null);
  const cutlistActivityNextIdRef = useRef<number>(1);
  const cutlistActivityDraggingRef = useRef(false);
  const [cutlistActivityIsDragging, setCutlistActivityIsDragging] = useState(false);
  const cutlistActivityActivePointerIdRef = useRef<number | null>(null);
  const cutlistActivityDragStartXRef = useRef(0);
  const cutlistActivityDragStartOffsetRef = useRef(0);
  const [cutlistActivityOffset, setCutlistActivityOffset] = useState(0);
  const cutlistActivityOffsetRef = useRef(0);
  const cutlistActivityMinOffsetRef = useRef(0);
  const cutlistActivityMaxOffsetRef = useRef(0);
  const cutlistActivityRafRef = useRef<number | null>(null);
  const cutlistActivityPendingOffsetRef = useRef<number | null>(null);
  const cutlistActivityPersistTimeoutRef = useRef<number | null>(null);
  const cutlistActivityProjectHydratedRef = useRef(false);
  const lastPersistedCutlistActivityJsonRef = useRef("");
    const [collapsedCutlistGroups, setCollapsedCutlistGroups] = useState<Record<string, boolean>>({});
    const [initialCollapsedCutlistGroups, setInitialCollapsedCutlistGroups] = useState<Record<string, boolean>>({});
    const [pendingDeleteRowsByGroup, setPendingDeleteRowsByGroup] = useState<Record<string, string[]>>({});
    const [deleteConfirmArmedGroups, setDeleteConfirmArmedGroups] = useState<Record<string, boolean>>({});
    const [initialPendingDeleteRowsByGroup, setInitialPendingDeleteRowsByGroup] = useState<Record<string, string[]>>({});
    const [initialDeleteConfirmArmedGroups, setInitialDeleteConfirmArmedGroups] = useState<Record<string, boolean>>({});
    const [initialDeleteAllArmed, setInitialDeleteAllArmed] = useState(false);
    const [editingCell, setEditingCell] = useState<{ rowId: string; key: CutlistEditableField } | null>(null);
  const [initialEditingCell, setInitialEditingCell] = useState<{ rowId: string; key: CutlistEditableField } | null>(null);
  const cncExportMenuRef = useRef<HTMLDivElement | null>(null);
  const [initialEditingCellValue, setInitialEditingCellValue] = useState("");
  const [editingCellValue, setEditingCellValue] = useState("");
  const [editingClashLeft, setEditingClashLeft] = useState("");
  const [editingClashRight, setEditingClashRight] = useState("");
  const [editingFixedShelf, setEditingFixedShelf] = useState("");
  const [editingAdjustableShelf, setEditingAdjustableShelf] = useState("");
  const [editingFixedShelfDrilling, setEditingFixedShelfDrilling] = useState<"No" | "Even Spacing" | "Centre">("No");
  const [editingAdjustableShelfDrilling, setEditingAdjustableShelfDrilling] = useState<"No" | "Even Spacing" | "Centre">("No");
  const editingFixedShelfRef = useRef("");
  const editingAdjustableShelfRef = useRef("");
  const editingFixedShelfDrillingRef = useRef<"No" | "Even Spacing" | "Centre">("No");
  const editingAdjustableShelfDrillingRef = useRef<"No" | "Even Spacing" | "Centre">("No");
  const isCommittingCutlistCellRef = useRef(false);
  const [editingInfoFocusLine, setEditingInfoFocusLine] = useState<{ rowId: string; lineIndex: number } | null>(null);
  const [expandedCabinetryRows, setExpandedCabinetryRows] = useState<Record<string, boolean>>({});
  const [expandedDrawerRows, setExpandedDrawerRows] = useState<Record<string, boolean>>({});
  const [cutlistJumpTarget, setCutlistJumpTarget] = useState<{
    parentRowId: string;
    kind: "cab" | "drw" | null;
    subKey: string;
  } | null>(null);
  const [cutlistUiStateReady, setCutlistUiStateReady] = useState(false);
  const [productionForm, setProductionForm] = useState<ProductionFormState>({
    existing: { carcassThickness: "", panelThickness: "", frontsThickness: "" },
    cabinetry: { baseCabHeight: "", footDistanceBack: "", tallCabHeight: "", footHeight: "", hobCentre: "", hobSide: "" },
    hardware: { hardwareCategory: "", newDrawerType: "", hingeType: "" },
    boardTypes: [],
  });
  const [orderMiscDraftByCategory, setOrderMiscDraftByCategory] = useState<Record<string, Record<string, OrderMiscDraftRow>>>({});
  const orderMiscDraftByCategoryRef = useRef(orderMiscDraftByCategory);
  const [orderHingeRowsByCategory, setOrderHingeRowsByCategory] = useState<Record<string, OrderHingeRow[]>>({});
  const orderHingeRowsByCategoryRef = useRef(orderHingeRowsByCategory);
  const projectImagesInputRef = useRef<HTMLInputElement | null>(null);
  const projectFilesInputRef = useRef<HTMLInputElement | null>(null);
  const projectImageThumbsRef = useRef<HTMLDivElement | null>(null);
  const projectImageViewportRef = useRef<HTMLDivElement | null>(null);
  const projectImagePreviewRef = useRef<HTMLImageElement | null>(null);
  const projectImageDragRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const [projectImageMeasuredHeight, setProjectImageMeasuredHeight] = useState(0);
  const [projectImageZoom, setProjectImageZoom] = useState(1);
  const [projectImagePan, setProjectImagePan] = useState({ x: 0, y: 0 });
  const [projectImageDragging, setProjectImageDragging] = useState(false);
  const clientDetailsContainerRef = useRef<HTMLDivElement | null>(null);
  const notesContainerRef = useRef<HTMLDivElement | null>(null);
  const notesEditorRef = useRef<HTMLDivElement | null>(null);
  const notesLastEnterAtRef = useRef(0);
  const projectFilesTotalBytes = useMemo(
    () => projectFiles.reduce((sum, row) => sum + Math.max(0, Number(row.size) || 0), 0),
    [projectFiles],
  );
  const openProjectFilePreview = useMemo(
    () => projectFiles.find((row) => row.id === openProjectFilePreviewId) ?? null,
    [projectFiles, openProjectFilePreviewId],
  );

  const tab = useMemo(() => {
    const requestedTab = searchParams.get("tab");
    const allowedTabs = new Set(tabItems.map((item) => item.value));
    if (requestedTab && allowedTabs.has(requestedTab)) {
      return requestedTab;
    }
    return "general";
  }, [searchParams]);

  const effectiveRole = companyAccess?.role ?? user?.role ?? "viewer";
  const effectivePermissions = companyAccess?.permissionKeys ?? user?.permissions ?? [];
  const salesAccess = projectTabAccess(project, effectiveRole, "sales", user?.uid, effectivePermissions);
  const productionAccess = projectTabAccess(project, effectiveRole, "production", user?.uid, effectivePermissions);
  const settingsAccess = projectTabAccess(project, effectiveRole, "settings", user?.uid, effectivePermissions);
  const generalAccess = projectTabAccess(project, effectiveRole, "general", user?.uid, effectivePermissions);
  const salesReadOnly = salesAccess.view && !salesAccess.edit;
  const productionReadOnly = productionAccess.view && !productionAccess.edit;
  const canEditStatus =
    effectiveRole === "owner" ||
    effectiveRole === "admin" ||
    effectivePermissions.some((p) => String(p).toLowerCase() === "projects.status");
  const canDeleteProject =
    effectiveRole === "owner" ||
    effectiveRole === "admin" ||
    effectivePermissions.some((p) => String(p).toLowerCase() === "projects.delete");
  const canEditTags = generalAccess.edit;
  const canGrantProductionUnlock =
    effectiveRole === "owner" ||
    effectiveRole === "admin" ||
    effectivePermissions.some((p) => String(p).toLowerCase() === "production.key");
  const productionUnlockRemainingSeconds = getProductionUnlockRemainingSeconds(project, user?.uid) + unlockTick * 0;
  const productionTabLabel =
    productionUnlockRemainingSeconds > 0
      ? `Production (${Math.max(1, Math.ceil(productionUnlockRemainingSeconds / 60))}m)`
      : "Production";
  const boardThicknessOptions = useMemo(
    () => normalizeMmOptions(companyDoc?.boardThicknesses),
    [companyDoc?.boardThicknesses],
  );
  const boardFinishOptions = useMemo(
    () => normalizeBoardFinishes(companyDoc?.boardFinishes),
    [companyDoc?.boardFinishes],
  );
  const sheetSizeOptions = useMemo(
    () => normalizeSheetSizes(companyDoc?.sheetSizes),
    [companyDoc?.sheetSizes],
  );
  const hardwareRows = useMemo(
    () => normalizeHardwareRows(companyDoc?.hardwareSettings),
    [companyDoc?.hardwareSettings],
  );
  const boardColourMemory = useMemo(
    () => normalizeBoardColourMemory(companyDoc?.boardMaterialUsage),
    [companyDoc?.boardMaterialUsage],
  );
  const boardColourSuggestions = useMemo(
    () => boardColourMemory.map((row) => row.value),
    [boardColourMemory],
  );
  const companyTagSuggestions = useMemo(
    () => normalizeProjectTagUsage((companyDoc?.projectTagUsage ?? {}) as Record<string, unknown>),
    [companyDoc?.projectTagUsage],
  );
  const availableTagSuggestions = useMemo(
    () =>
      companyTagSuggestions
        .map((row) => row.value)
        .filter((value) => !projectTags.some((tag) => tag.toLowerCase() === value.toLowerCase())),
    [companyTagSuggestions, projectTags],
  );
  const filteredTagSuggestions = useMemo(() => {
    const q = String(tagInput || "").trim().toLowerCase();
    if (!q) return availableTagSuggestions.slice(0, 12);
    const starts = availableTagSuggestions.filter((tag) => tag.toLowerCase().startsWith(q));
    const contains = availableTagSuggestions.filter(
      (tag) => !tag.toLowerCase().startsWith(q) && tag.toLowerCase().includes(q),
    );
    return [...starts, ...contains].slice(0, 12);
  }, [availableTagSuggestions, tagInput]);
  const salesPayload = useMemo(() => {
    const raw = (project?.projectSettings ?? {}) as Record<string, unknown>;
    const payload = raw.sales;
    if (payload && typeof payload === "object") return { ...(payload as Record<string, unknown>) };
    if (typeof payload === "string" && payload.trim()) {
      try {
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed === "object") return { ...(parsed as Record<string, unknown>) };
      } catch {
        return {};
      }
    }
    return {};
  }, [project?.projectSettings]);
  const projectCutlistActivityFeed = useMemo(() => {
    const settings = (project?.projectSettings ?? {}) as Record<string, unknown>;
    const raw =
      settings.cutlistActivityFeeds ??
      settings.cutlistActivities ??
      settings.activityFeeds ??
      null;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const item = raw as Record<string, unknown>;
      const production = normalizeCutlistActivityEntries(item.production).map((entry) => ({
        ...entry,
        scope: "production" as const,
      }));
      const initial = normalizeCutlistActivityEntries(item.initial).map((entry) => ({
        ...entry,
        scope: "initial" as const,
      }));
      return [...production, ...initial]
        .sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
        .slice(-120);
    }
    return normalizeCutlistActivityEntries(raw);
  }, [project?.projectSettings]);
  const salesRoomRows = useMemo(
    () => normalizeSalesRooms((salesPayload as Record<string, unknown>).rooms),
    [salesPayload],
  );
  const salesRoomNames = useMemo(() => salesRoomRows.map((row) => row.name), [salesRoomRows]);
  const companyQuoteExtras = useMemo(
    () => normalizeSalesQuoteExtras((companyDoc as Record<string, unknown> | null)?.quoteExtras),
    [companyDoc],
  );
  const salesQuoteExtrasIncluded = useMemo(() => {
    const raw = (salesPayload as Record<string, unknown>).quoteExtrasIncluded;
    if (!Array.isArray(raw)) return [] as string[];
    return raw.map((item) => String(item ?? "").trim()).filter(Boolean);
  }, [salesPayload]);
  const activeSalesQuoteExtraSet = useMemo(() => {
    const set = new Set<string>();
    for (const key of salesQuoteExtrasIncluded) {
      set.add(key);
      const matchedById = companyQuoteExtras.find((row) => row.id === key);
      if (matchedById?.name) set.add(matchedById.name);
      const matchedByName = companyQuoteExtras.find((row) => row.name === key);
      if (matchedByName?.id) set.add(matchedByName.id);
    }
    return set;
  }, [companyQuoteExtras, salesQuoteExtrasIncluded]);
  const displayedSalesQuoteExtras = useMemo(
    () =>
      companyQuoteExtras.map((row) => ({
        ...row,
        included: activeSalesQuoteExtraSet.has(row.id) || activeSalesQuoteExtraSet.has(row.name),
      })),
    [activeSalesQuoteExtraSet, companyQuoteExtras],
  );
  const salesQuoteHelpers = useMemo(
    () => normalizeSalesQuoteHelpers((companyDoc as Record<string, unknown> | null)?.salesQuoteHelpers),
    [companyDoc],
  );
  const quoteExtraContainerVisibility = useMemo(() => {
    const grouped = new Map<string, boolean[]>();
    displayedSalesQuoteExtras.forEach((row) => {
      const key = String(row.templateContainerId || "").trim();
      if (!key) return;
      const list = grouped.get(key) ?? [];
      list.push(Boolean(row.included));
      grouped.set(key, list);
    });
    return grouped;
  }, [displayedSalesQuoteExtras]);
  const hiddenQuoteContainerIdSet = useMemo(() => {
    const hidden = new Set<string>();
    quoteExtraContainerVisibility.forEach((states, key) => {
      if (states.length > 0 && !states.some(Boolean)) hidden.add(key);
    });
    return hidden;
  }, [quoteExtraContainerVisibility]);
  const quoteExtraBlockVisibility = useMemo(() => {
    const grouped = new Map<string, boolean[]>();
    displayedSalesQuoteExtras.forEach((row) => {
      const key = String(row.templateBlockId || "").trim();
      if (!key) return;
      const list = grouped.get(key) ?? [];
      list.push(Boolean(row.included));
      grouped.set(key, list);
    });
    return grouped;
  }, [displayedSalesQuoteExtras]);
  const hiddenQuoteBlockIdSet = useMemo(() => {
    const hidden = new Set<string>();
    quoteExtraBlockVisibility.forEach((states, key) => {
      if (states.length > 0 && !states.some(Boolean)) hidden.add(key);
    });
    return hidden;
  }, [quoteExtraBlockVisibility]);
  const quoteExtraPlaceholderVisibility = useMemo(() => {
    const grouped = new Map<string, boolean[]>();
    displayedSalesQuoteExtras.forEach((row) => {
      const key = String(row.templatePlaceholderKey || "").trim();
      if (!key) return;
      const list = grouped.get(key) ?? [];
      list.push(Boolean(row.included));
      grouped.set(key, list);
    });
    return grouped;
  }, [displayedSalesQuoteExtras]);
  const disabledQuotePlaceholderKeySet = useMemo(() => {
    const hidden = new Set<string>();
    quoteExtraPlaceholderVisibility.forEach((states, key) => {
      if (states.length > 0 && !states.some(Boolean)) hidden.add(key);
    });
    return hidden;
  }, [quoteExtraPlaceholderVisibility]);
  const rawSalesProductRows = useMemo(() => {
    const payload = salesPayload as Record<string, unknown>;
    const candidates = [
      payload.products,
      payload.productRows,
      payload.productSelections,
      payload.salesProducts,
      payload.jobTypes,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeSalesProducts(candidate);
      if (normalized.length) return normalized;
    }
    return [];
  }, [salesPayload]);
  const companySalesProductConfigs = useMemo(() => {
    const raw = Array.isArray((companyDoc as Record<string, unknown> | null)?.salesJobTypes)
      ? (((companyDoc as Record<string, unknown> | null)?.salesJobTypes) as unknown[])
      : [];
    const defaultSheet = sheetSizeOptions.find((row) => row.isDefault) ?? sheetSizeOptions[0] ?? null;
    const defaultSheetLabel = defaultSheet ? `${defaultSheet.h} x ${defaultSheet.w}` : "";
    const canonicalSizeKey = (value: string) => {
      const pair = parseSheetSizePair(value);
      if (!pair) return "";
      const [a, b] = pair;
      return `${Math.max(a, b)}x${Math.min(a, b)}`;
    };
    return raw
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const item = row as Record<string, unknown>;
        const name = String(item.name ?? "").trim();
        const showInSales = Boolean(item.showInSales ?? true);
        const sheetPriceRows = Array.isArray(item.sheetPrices) ? (item.sheetPrices as Record<string, unknown>[]) : [];
        const parsedOptions = sheetPriceRows
          .map((sheetRow) => {
            const sheetSize = String(sheetRow?.sheetSize ?? "").trim();
            const pair = parseSheetSizePair(sheetSize);
            if (!pair) return null;
            const [a, b] = pair;
            return {
              sheetSize,
              width: Math.max(a, b),
              height: Math.min(a, b),
              price: toNum(sheetRow?.pricePerSheet),
              canonicalKey: canonicalSizeKey(sheetSize),
            };
          })
          .filter((option): option is { sheetSize: string; width: number; height: number; price: number; canonicalKey: string } => Boolean(option))
          .sort((a, b) => a.width * a.height - b.width * b.height);
        const defaultKey = canonicalSizeKey(defaultSheetLabel);
        const defaultOption =
          parsedOptions.find((option) => option.canonicalKey === defaultKey) ??
          parsedOptions[0] ??
          null;
        return {
          name,
          showInSales,
          grain: Boolean(item.grain ?? item.isGrain ?? false),
          options: parsedOptions,
          defaultOption,
        };
      })
      .filter((row) => row.name && row.showInSales);
  }, [companyDoc, sheetSizeOptions]);
  const companySalesProductNames = useMemo(
    () => companySalesProductConfigs.map((row) => row.name),
    [companySalesProductConfigs],
  );
  const salesProductRows = useMemo(() => {
    const selectedByName = new Map(
      rawSalesProductRows.map((row) => [String(row.name || "").trim().toLowerCase(), Boolean(row.selected)]),
    );
    const merged = companySalesProductNames.map((name) => ({
      name,
      selected: Boolean(selectedByName.get(name.toLowerCase())),
    }));
    return merged;
  }, [companySalesProductNames, rawSalesProductRows]);
  const salesQuoteProjectText = useMemo(() => {
    const raw = (salesPayload as Record<string, unknown>).quoteProjectText;
    if (!raw || typeof raw !== "object") return {} as Record<string, string>;
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]),
    );
  }, [salesPayload]);
  const selectedSalesProductNames = useMemo(
    () => salesProductRows.filter((row) => row.selected).map((row) => row.name),
    [salesProductRows],
  );
  const quoteLayoutTemplate = useMemo(
    () => normalizeProjectQuoteTemplate(companyDoc?.quoteLayoutTemplate),
    [companyDoc],
  );
  const initialMeasureBoardOptions = useMemo(
    () => salesProductRows.filter((row) => row.selected).map((row) => row.name),
    [salesProductRows],
  );
  useEffect(() => {
    setQuoteProjectTextDrafts(salesQuoteProjectText);
  }, [salesQuoteProjectText]);
  useEffect(() => {
    const rawCutlist = (salesPayload as Record<string, unknown>).initialCutlist;
    const rawRows =
      rawCutlist && typeof rawCutlist === "object" && Array.isArray((rawCutlist as Record<string, unknown>).rows)
        ? ((rawCutlist as Record<string, unknown>).rows as unknown[])
        : [];
    const mapped = rawRows
      .filter((row) => row && typeof row === "object")
      .map((row, idx) => {
        const item = row as Record<string, unknown>;
        const grainParsed = parseCutlistGrainFields(item.Grain ?? item.grain, item.grain);
        const clashing = String(item.Clashing ?? item.clashing ?? "").trim();
        const split = splitClashing(clashing);
        return {
          id: String(item.__cutlist_key ?? item.__id ?? `im_row_${idx + 1}`),
          room: String(item.Room ?? item.room ?? "Project Cutlist"),
          partType: String(item.partType ?? item.PartType ?? ""),
          board: String(item.Board ?? item.board ?? ""),
          name: String(item.Name ?? item.name ?? ""),
          height: normalizeCutlistDimensionValue(item.Height ?? item.height),
          width: normalizeCutlistDimensionValue(item.Width ?? item.width),
          depth: normalizeCutlistDimensionValue(item.Depth ?? item.depth),
          quantity: String(item.Quantity ?? item.quantity ?? "1"),
          clashing,
          clashLeft: String(item.clashLeft ?? split.left ?? "").trim().toUpperCase(),
          clashRight: String(item.clashRight ?? split.right ?? "").trim().toUpperCase(),
          fixedShelf: String(item.fixedShelf ?? item.FixedShelf ?? ""),
          adjustableShelf: String(item.adjustableShelf ?? item.AdjustableShelf ?? ""),
          fixedShelfDrilling: normalizeDrillingValue(item.fixedShelfDrilling ?? item.FixedShelfDrilling ?? "No"),
          adjustableShelfDrilling: normalizeDrillingValue(item.adjustableShelfDrilling ?? item.AdjustableShelfDrilling ?? "No"),
          information: String(item.Information ?? item.information ?? ""),
          grain: grainParsed.grain,
          grainValue: grainParsed.grainValue,
          includeInNesting:
            !(
              item.includeInNesting === false ||
              String(item.includeInNesting ?? "").trim().toLowerCase() === "false"
            ),
        } satisfies CutlistRow;
      });
    setInitialCutlistRows(mapped);
  }, [salesPayload]);
  const boardBaseLabelFromRow = (row: ProductionBoardRow) => {
    const colour = String(row.colour || "").trim();
    const thicknessRaw = String(row.thickness || "").trim();
    const finish = String(row.finish || "").trim();
    const thickness = thicknessRaw
      ? thicknessRaw.toLowerCase().endsWith("mm")
        ? thicknessRaw
        : `${thicknessRaw}mm`
      : "";
    return [colour, thickness, finish].filter(Boolean).join(" ").trim();
  };
  const boardKeyFromRow = (row: ProductionBoardRow) => {
    const label = boardBaseLabelFromRow(row);
    if (!label) return "";
    const sheet = String(row.sheetSize || "").trim();
    return sheet ? `${label} @@ ${sheet}` : label;
  };
  const boardMetaByKey = useMemo(() => {
    const out: Record<string, { label: string; sheet: string; size: string; lacquer: boolean; thickness: number; grain: boolean }> = {};
    for (const row of productionForm.boardTypes) {
      const key = boardKeyFromRow(row);
      if (!key) continue;
      const label = boardBaseLabelFromRow(row);
      const sheet = String(row.sheetSize || "").trim();
      const mm = Number.parseFloat(sheet.split("x")[0]?.trim() || "");
      const size = Number.isFinite(mm) && mm > 0
        ? (Math.floor(mm / 100) / 10).toFixed(1).replace(/\.0$/, "")
        : "";
      out[key] = {
        label,
        sheet,
        size,
        lacquer: Boolean(row.lacquer),
        thickness: toNum(row.thickness),
        grain: Boolean(row.grain),
      };
    }
    return out;
  }, [productionForm.boardTypes]);
  const cutlistBoardOptions = useMemo(() => Object.keys(boardMetaByKey), [boardMetaByKey]);
  const resolveBoardKey = (value: string) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (boardMetaByKey[raw]) return raw;
    const legacyMatch = Object.entries(boardMetaByKey).find(([, meta]) => meta.label === raw)?.[0];
    return legacyMatch ?? raw;
  };
  const boardSizeByLabel = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [key, meta] of Object.entries(boardMetaByKey)) {
      if (meta.size) out[key] = meta.size;
    }
    return out;
  }, [boardMetaByKey]);
  const boardLacquerByLabel = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const [key, meta] of Object.entries(boardMetaByKey)) out[key] = meta.lacquer;
    return out;
  }, [boardMetaByKey]);
  const boardSheetByLabel = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [key, meta] of Object.entries(boardMetaByKey)) out[key] = meta.sheet;
    return out;
  }, [boardMetaByKey]);
  const boardThicknessByLabel = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, meta] of Object.entries(boardMetaByKey)) out[key] = meta.thickness;
    return out;
  }, [boardMetaByKey]);
  const boardGrainByLabel = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const [key, meta] of Object.entries(boardMetaByKey)) out[key] = Boolean(meta.grain);
    return out;
  }, [boardMetaByKey]);
  const boardSizeFor = (value: string) => boardSizeByLabel[resolveBoardKey(value)] ?? "";
  const boardSheetFor = (value: string) => boardSheetByLabel[resolveBoardKey(value)] ?? "";
  const boardLacquerFor = (value: string) => Boolean(boardLacquerByLabel[resolveBoardKey(value)]);
  const boardThicknessFor = (value: string) => boardThicknessByLabel[resolveBoardKey(value)] ?? 0;
  const boardGrainFor = (value: string) => Boolean(boardGrainByLabel[resolveBoardKey(value)]);
  const initialMeasureBoardGrainMap = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const row of companySalesProductConfigs) {
      const key = String(row.name || "").trim().toLowerCase();
      if (!key) continue;
      out[key] = Boolean(row.grain);
    }
    return out;
  }, [companySalesProductConfigs]);
  const initialMeasureBoardGrainFor = (value: string) =>
    Boolean(initialMeasureBoardGrainMap[String(value || "").trim().toLowerCase()]);
  const boardDisplayLabel = (value: string) => {
    const key = resolveBoardKey(value);
    return boardMetaByKey[key]?.label ?? String(value || "").trim();
  };
  const boardOptionLabel = (value: string) => {
    const key = resolveBoardKey(value);
    const meta = boardMetaByKey[key];
    if (!meta) return value;
    return meta.label;
  };
  const showCutlistGrainColumn = useMemo(
    () => productionForm.boardTypes.some((row) => Boolean(row.grain)),
    [productionForm.boardTypes],
  );
  const showInitialCutlistGrainColumn = useMemo(
    () =>
      salesProductRows.some((row) => row.selected && initialMeasureBoardGrainFor(row.name)) ||
      initialCutlistRows.some((row) => initialMeasureBoardGrainFor(String(row.board || "").trim()) || String(row.grainValue ?? "").trim().length > 0) ||
      initialCutlistDraftRows.some((row) => initialMeasureBoardGrainFor(String(row.board || "").trim()) || String(row.grainValue ?? "").trim().length > 0) ||
      initialMeasureBoardGrainFor(String(initialCutlistEntry.board || "").trim()) ||
      String(initialCutlistEntry.grainValue ?? "").trim().length > 0,
    [salesProductRows, initialCutlistRows, initialCutlistDraftRows, initialCutlistEntry, initialMeasureBoardGrainMap],
  );
  const grainDimensionOptions = (height: string, width: string, depth: string) => {
    const h = String(height ?? "").trim();
    const w = String(width ?? "").trim();
    const d = String(depth ?? "").trim();
    const out: string[] = [];
    if (h) out.push(`H:${h}`);
    if (w) out.push(`W:${w}`);
    if (d) out.push(`D:${d}`);
    return out;
  };
  const resolveGrainAxis = (
    grainValue: string,
    height: string,
    width: string,
    depth: string,
  ): "height" | "width" | "depth" | null => {
    const g = String(grainValue ?? "").trim();
    if (!g) return null;
    const prefixed = g.match(/^([HWD])\s*:\s*(.+)$/i);
    if (prefixed) {
      const axis = String(prefixed[1] || "").toUpperCase();
      if (axis === "H") return "height";
      if (axis === "W") return "width";
      if (axis === "D") return "depth";
    }
    if (matchesGrainDimension(g, height, "height")) return "height";
    if (matchesGrainDimension(g, width, "width")) return "width";
    if (matchesGrainDimension(g, depth, "depth")) return "depth";
    return null;
  };
  const grainDimensionOptionsForRow = (rowLike: Pick<CutlistRow, "partType" | "height" | "width" | "depth">) => {
    if (isCabinetryPartType(String(rowLike.partType || ""))) {
      const h = String(rowLike.height ?? "").trim();
      const w = String(rowLike.width ?? "").trim();
      const out: string[] = [];
      if (h) out.push(`H:${h}`);
      if (w) out.push(`W:${w}`);
      return out;
    }
    return grainDimensionOptions(String(rowLike.height ?? ""), String(rowLike.width ?? ""), String(rowLike.depth ?? ""));
  };
  const initialMeasureGrainDimensionOptionsForRow = (
    rowLike: Pick<CutlistRow, "partType" | "height" | "width" | "depth">,
  ) => {
    const out: string[] = [];
    const pushUnique = (value: string) => {
      const normalized = String(value ?? "").trim();
      if (!normalized || out.includes(normalized)) return;
      out.push(normalized);
    };
    const h = String(rowLike.height ?? "").trim();
    const w = String(rowLike.width ?? "").trim();
    const d = String(rowLike.depth ?? "").trim();
    if (isCabinetryPartType(String(rowLike.partType || ""))) {
      pushUnique(h);
      pushUnique(w);
      return out;
    }
    pushUnique(h);
    pushUnique(w);
    pushUnique(d);
    return out;
  };
  const cabinetryPieceGrainValue = (row: CutlistRow, piece: CabinetryDerivedPiece): string => {
    const rowGrainValue = String(row.grainValue ?? "").trim();
    if (!rowGrainValue) return "";
    const axis = resolveGrainAxis(rowGrainValue, row.height, row.width, row.depth);
    if (!axis) return rowGrainValue;
    const h = String(piece.height ?? "").trim();
    const w = String(piece.width ?? "").trim();
    const d = String(piece.depth ?? "").trim();
    const toPrefixed = (key: "height" | "width" | "depth", value: string) => {
      const v = String(value ?? "").trim();
      if (!v) return "";
      return `${key === "height" ? "H" : key === "width" ? "W" : "D"}:${v}`;
    };
    if (axis === "height") {
      if (piece.key === "top" || piece.key === "bottom" || piece.key === "fixed_shelf" || piece.key === "adjustable_shelf") {
        return toPrefixed("width", w);
      }
      if (piece.key === "back") return toPrefixed("height", h);
      if (piece.key === "left_side" || piece.key === "right_side") return toPrefixed("height", h);
      return toPrefixed("height", h) || toPrefixed("width", w) || toPrefixed("depth", d) || rowGrainValue;
    }
    if (axis === "width") {
      if (piece.key === "left_side" || piece.key === "right_side") return toPrefixed("depth", d);
      if (
        piece.key === "top" ||
        piece.key === "bottom" ||
        piece.key === "fixed_shelf" ||
        piece.key === "adjustable_shelf" ||
        piece.key === "back"
      ) {
        return toPrefixed("width", w);
      }
      return toPrefixed("width", w) || toPrefixed("depth", d) || toPrefixed("height", h) || rowGrainValue;
    }
    return toPrefixed("depth", d) || toPrefixed("width", w) || toPrefixed("height", h) || rowGrainValue;
  };
  const matchesGrainDimension = (
    grainValue: string,
    dimensionValue: string,
    dimensionKey?: "height" | "width" | "depth",
  ) => {
    const g = String(grainValue ?? "").trim();
    const d = String(dimensionValue ?? "").trim();
    if (!g || !d) return false;
    const prefixed = g.match(/^([HWD])\s*:\s*(.+)$/i);
    if (prefixed) {
      if (!dimensionKey) return false;
      const axis = prefixed[1].toUpperCase();
      const mappedKey = axis === "H" ? "height" : axis === "W" ? "width" : "depth";
      if (mappedKey !== dimensionKey) return false;
      const gv = String(prefixed[2] ?? "").trim();
      if (!gv) return false;
      const gNumMatch = gv.match(/-?\d+(?:\.\d+)?/);
      const dNumMatch = d.match(/-?\d+(?:\.\d+)?/);
      const gn = gNumMatch ? Number.parseFloat(gNumMatch[0]) : Number.NaN;
      const dn = dNumMatch ? Number.parseFloat(dNumMatch[0]) : Number.NaN;
      if (Number.isFinite(gn) && Number.isFinite(dn)) {
        return Math.abs(gn - dn) < 0.001;
      }
      return gv.toLowerCase() === d.toLowerCase();
    }
    const gNumMatch = g.match(/-?\d+(?:\.\d+)?/);
    const dNumMatch = d.match(/-?\d+(?:\.\d+)?/);
    const gn = gNumMatch ? Number.parseFloat(gNumMatch[0]) : Number.NaN;
    const dn = dNumMatch ? Number.parseFloat(dNumMatch[0]) : Number.NaN;
    if (Number.isFinite(gn) && Number.isFinite(dn)) {
      return Math.abs(gn - dn) < 0.001;
    }
    return g.toLowerCase() === d.toLowerCase();
  };

  const tabItemsWithAccess = useMemo(
    () =>
      tabItems.map((item) => {
        if (item.value === "sales") {
          return { ...item, disabled: !salesAccess.view, title: !salesAccess.view ? "Sales is locked for your role" : undefined };
        }
        if (item.value === "production") {
          return {
            ...item,
            label: productionTabLabel,
            disabled: !productionAccess.view,
            title: !productionAccess.view ? "Production is locked for your role" : undefined,
          };
        }
        if (item.value === "settings") {
          return { ...item, disabled: !settingsAccess.view, title: !settingsAccess.view ? "Settings is locked for your role" : undefined };
        }
        return item;
      }),
    [productionAccess.view, productionTabLabel, salesAccess.view, settingsAccess.view],
  );

  const resolvedTab = (() => {
    if (tab === "sales" && !salesAccess.view) {
      return "general";
    }
    if (tab === "production" && !productionAccess.view) {
      return "general";
    }
    if (tab === "settings" && !settingsAccess.view) {
      return "general";
    }
    return tab;
  })();
  const prevResolvedTabRef = useRef<string>(resolvedTab);
  useEffect(() => {
    const prev = prevResolvedTabRef.current;
    if (resolvedTab === "sales" && prev !== "sales") {
      setSalesNav("items");
    }
    if (resolvedTab === "production" && prev !== "production") {
      setProductionNav("overview");
      setNestingFullscreen(false);
    }
    prevResolvedTabRef.current = resolvedTab;
  }, [resolvedTab]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setUnlockTick((v) => v + 1);
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const formatUnlockTimer = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h <= 0) {
      return `${Math.max(1, m)}m`;
    }
    return `${h}h ${m}m`;
  };

  const defaultHardwareCategory = () => {
    const marked = hardwareRows.find((row) => row.isDefault)?.name;
    if (marked) return marked;
    return hardwareRows[0]?.name ?? "";
  };

  const drawerOptionsForCategory = (category: string) => {
    const row = hardwareRows.find((item) => item.name === category);
    return row?.drawers ?? [];
  };

  const defaultDrawerForCategory = (category: string) => {
    const options = drawerOptionsForCategory(category);
    const marked = options.find((row) => row.isDefault)?.name;
    if (marked) return marked;
    return options[0]?.name ?? "";
  };

  const drawerHeightLetterOptions = useMemo(() => {
    const selectedCategory = String(productionForm.hardware.hardwareCategory || defaultHardwareCategory()).trim();
    const categoryRow = hardwareRows.find((row) => row.name.toLowerCase() === selectedCategory.toLowerCase());
    const categoryDrawerOptions = categoryRow?.drawers ?? [];
    const categoryDefaultDrawer = categoryDrawerOptions.find((row) => row.isDefault)?.name ?? categoryDrawerOptions[0]?.name ?? "";
    const selectedDrawer = String(productionForm.hardware.newDrawerType || categoryDefaultDrawer).trim();
    const categories = selectedCategory
      ? hardwareRows.filter((row) => row.name.toLowerCase() === selectedCategory.toLowerCase())
      : hardwareRows;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const cat of categories) {
      for (const drawer of cat.drawers ?? []) {
        const name = String(drawer?.name ?? "").trim();
        if (selectedDrawer && name.toLowerCase() !== selectedDrawer.toLowerCase()) {
          continue;
        }
        const letters = Array.isArray(drawer.heightLetters) ? drawer.heightLetters : [];
        for (const letterItem of letters) {
          const letter = String(letterItem ?? "").trim();
          if (!letter) continue;
          const key = letter.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(letter);
        }
        if (selectedDrawer) return out;
      }
    }
    return out;
  }, [hardwareRows, productionForm.hardware.hardwareCategory, productionForm.hardware.newDrawerType]);

  const defaultSheetSize = () => {
    const marked = sheetSizeOptions.find((row) => row.isDefault);
    const target = marked ?? sheetSizeOptions[0];
    return target ? `${target.h} x ${target.w}` : "";
  };

  const newBoardRow = (): ProductionBoardRow => ({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    colour: "",
    thickness: boardThicknessOptions[0] ?? "",
    finish: boardFinishOptions[0] ?? "",
    edging: "Matching",
    grain: false,
    lacquer: false,
    sheetSize: defaultSheetSize(),
    sheets: "",
    edgetape: "",
  });

  const cutlistColumns = useMemo(() => {
    const raw = (companyDoc?.cutlistColumnsByContext ?? {}) as Record<string, unknown>;
    const production = Array.isArray(raw.production) ? raw.production : [];
    const cleaned = production.map((v) => String(v ?? "").trim()).filter(Boolean);
    return cleaned.length ? cleaned : ["Part Type", "Board", "Part Name", "Height", "Width", "Depth", "Quantity", "Clashing", "Information", "Grain"];
  }, [companyDoc?.cutlistColumnsByContext]);
  const initialCutlistColumns = useMemo(() => {
    const raw = (companyDoc?.cutlistColumnsByContext ?? {}) as Record<string, unknown>;
    const initial = Array.isArray(raw.initialMeasure) ? raw.initialMeasure : [];
    const cleaned = initial.map((v) => String(v ?? "").trim()).filter(Boolean);
    return cleaned.length ? cleaned : ["Part Type", "Board", "Part Name", "Height", "Width", "Depth", "Quantity", "Clashing", "Information", "Grain"];
  }, [companyDoc?.cutlistColumnsByContext]);

  const partTypeOptions = useMemo(() => {
    const raw = Array.isArray(companyDoc?.partTypes) ? companyDoc?.partTypes : [];
    const parsed = raw
      .filter((row) => row && typeof row === "object")
      .map((row) => toStr((row as Record<string, unknown>).name))
      .filter(Boolean);
    return parsed.length ? parsed : ["Cabinet", "Drawer", "Panel", "Front"];
  }, [companyDoc?.partTypes]);
  const initialMeasurePartTypeOptions = useMemo(() => {
    const raw = Array.isArray(companyDoc?.partTypes) ? companyDoc?.partTypes : [];
    const parsed = raw
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const item = row as Record<string, unknown>;
        const name = toStr(item.name);
        const initialMeasure = Boolean(
          item.initialMeasure ??
          item.inInitialMeasure ??
          item["Initial Measure"] ??
          item["initial measure"] ??
          false,
        );
        return { name, initialMeasure };
      })
      .filter((row) => row.name && row.initialMeasure)
      .map((row) => row.name);
    return parsed.length ? parsed : [];
  }, [companyDoc?.partTypes]);
  const cutlistUiStateStorageKey = useMemo(() => {
    if (!project?.id) return "";
    return `cutsmart.web.cutlist.ui.${user?.uid ?? "anon"}.${project.id}`;
  }, [project?.id, user?.uid]);

  const partTypeCabinetryMap = useMemo(() => {
    const out: Record<string, boolean> = {};
    const raw = Array.isArray(companyDoc?.partTypes) ? companyDoc.partTypes : [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const name = toStr(item.name);
      if (!name) continue;
      const isCabinetry = Boolean(
        item.cabinetry ??
        item.isCabinetry ??
        item.cabinetryEnabled ??
        item.enableCabinetry ??
        item.partTypeCabinetry,
      );
      out[name.trim().toLowerCase()] = isCabinetry;
    }
    return out;
  }, [companyDoc?.partTypes]);

  const isCabinetryPartType = (partType: string) =>
    Boolean(partTypeCabinetryMap[String(partType || "").trim().toLowerCase()]);

  const partTypeDrawerMap = useMemo(() => {
    const out: Record<string, boolean> = {};
    const raw = Array.isArray(companyDoc?.partTypes) ? companyDoc.partTypes : [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const name = toStr(item.name);
      if (!name) continue;
      const isDrawer = Boolean(
        item.drawer ??
        item.isDrawer ??
        item.drawerEnabled ??
        item.enableDrawer ??
        item.partTypeDrawer,
      );
      out[name.trim().toLowerCase()] = isDrawer;
    }
    return out;
  }, [companyDoc?.partTypes]);

  const isDrawerPartType = (partType: string) =>
    Boolean(partTypeDrawerMap[String(partType || "").trim().toLowerCase()]);

  const partTypeAutoClashMap = useMemo(() => {
    const out: Record<string, { left: string; right: string }> = {};
    const raw = Array.isArray(companyDoc?.partTypes) ? companyDoc.partTypes : [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const name = toStr(item.name);
      if (!name) continue;
      const leftRaw = toStr(item.autoClashLeft ?? item.clashLeft).toUpperCase().trim();
      const rightRaw = toStr(item.autoClashRight ?? item.clashRight).toUpperCase().trim();
      const left = leftRaw === "1L" || leftRaw === "2L" ? leftRaw : "";
      const right = rightRaw === "1S" || rightRaw === "2S" ? rightRaw : "";
      out[name.trim().toLowerCase()] = { left, right };
    }
    return out;
  }, [companyDoc?.partTypes]);

  const partTypeIncludeInNestingMap = useMemo(() => {
    const out: Record<string, boolean> = {};
    const raw = Array.isArray(companyDoc?.partTypes) ? companyDoc.partTypes : [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const name = toStr(item.name);
      if (!name) continue;
      const includeRaw =
        item.includeInNesting ??
        item.inNesting ??
        item.inclInNesting ??
        item.inclNesting ??
        item["Incl in Nesting"] ??
        item["InclInNesting"] ??
        item["incl in nesting"];
      const include =
        includeRaw === undefined
          ? true
          : !(
              includeRaw === false ||
              String(includeRaw ?? "").trim().toLowerCase() === "false" ||
              String(includeRaw ?? "").trim().toLowerCase() === "no" ||
              String(includeRaw ?? "").trim() === "0"
            );
      out[name.trim().toLowerCase()] = include;
    }
    return out;
  }, [companyDoc?.partTypes]);

  const isPartTypeIncludedInNesting = (partType: string) =>
    partTypeIncludeInNestingMap[String(partType || "").trim().toLowerCase()] !== false;

  const partTypeIncludeInCncMap = useMemo(() => {
    const out: Record<string, boolean> = {};
    const raw = Array.isArray(companyDoc?.partTypes) ? companyDoc.partTypes : [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const name = toStr(item.name);
      if (!name) continue;
      const includeRaw =
        item.includeInCutlists ??
        item.inCutlists ??
        item.inclInCutlists ??
        item.inclCutlists ??
        item.includeInCnc ??
        item.inCnc ??
        item["Incl in Cutlists"] ??
        item["InclInCutlists"] ??
        item["incl in cutlists"];
      const include =
        includeRaw === undefined
          ? true
          : !(
              includeRaw === false ||
              String(includeRaw ?? "").trim().toLowerCase() === "false" ||
              String(includeRaw ?? "").trim().toLowerCase() === "no" ||
              String(includeRaw ?? "").trim() === "0"
            );
      out[name.trim().toLowerCase()] = include;
    }
    return out;
  }, [companyDoc?.partTypes]);

  const isPartTypeIncludedInCnc = (partType: string) =>
    partTypeIncludeInCncMap[String(partType || "").trim().toLowerCase()] !== false;

  const partTypeColors = useMemo(() => {
    const defaults: Record<string, string> = {
      Front: "#F2D57A",
      Panel: "#C6E8AE",
      Extra: "#B7A4EB",
      Drawer: "#B8D8F8",
      Cabinet: "#4B5563",
      "Special Panel": "#BF1D1D",
      Unassigned: "#CBD5E1",
    };
    const out: Record<string, string> = { ...defaults };
    const raw = Array.isArray(companyDoc?.partTypes) ? companyDoc.partTypes : [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const name = toStr(item.name);
      if (!name) continue;
      const color = toStr(item.color ?? item.colour ?? item.hex ?? item.chipColor);
      const normalized = normalizeHexColor(color);
      if (normalized) out[name] = normalized;
    }
    return out;
  }, [companyDoc?.partTypes]);
  const activityColorsForPart = (partType: string, kind?: string) => {
    if (String(kind || "").toLowerCase() === "clear") {
      return {
        chipBg: "#FFDCDC",
        chipBorder: "#F2A7A7",
        chipText: "#7F1D1D",
        pillBg: "#FFECEC",
        pillBorder: "#F7B8B8",
        pillText: "#991B1B",
      };
    }
    const base = normalizeHexColor(partTypeColors[String(partType || "").trim()]) ?? "#C8D6E6";
    const textDark = "#0F172A";
    const textLight = "#F8FAFC";
    const useDark = isLightHex(base);
    return {
      chipBg: lightenHex(base, 0.38),
      chipBorder: darkenHex(base, 0.12),
      chipText: useDark ? textDark : textLight,
      pillBg: lightenHex(base, 0.18),
      pillBorder: darkenHex(base, 0.18),
      pillText: useDark ? textDark : textLight,
    };
  };
  const logCutlistActivity = (
    message: string,
    opts?: Partial<Omit<CutlistActivityEntry, "id" | "message">>,
  ) => {
    const msg = String(message || "").trim();
    if (!msg) return;
    const scope: "production" | "initial" = opts?.scope === "initial" ? "initial" : "production";
    const newId = Math.max(Date.now(), cutlistActivityNextIdRef.current + 1);
    cutlistActivityNextIdRef.current = newId;
    setCutlistActivityFeed((prev) => {
      const key = String(opts?.dedupeKey || "").trim();
      let next = [...prev];
      if (key) next = next.filter((item) => !(String(item.dedupeKey || "") === key && (item.scope || "production") === scope));
      next.push({
        id: newId,
        scope,
        message: msg,
        action: String(opts?.action || "").trim(),
        actionKind: (String(opts?.actionKind || "").trim().toLowerCase() as "clear" | "undo" | "") || "",
        dedupeKey: key,
        partType: String(opts?.partType || "").trim(),
        partTypeTo: String(opts?.partTypeTo || "").trim(),
        valueFrom: String(opts?.valueFrom || "").trim(),
        valueTo: String(opts?.valueTo || "").trim(),
      });
      if (next.length > 120) next = next.slice(next.length - 120);
      return next;
    });
    setCutlistActivityEnteringIds((prev) => ({ ...prev, [newId]: true }));
    window.requestAnimationFrame(() => {
      setCutlistActivityEnteringIds((prev) => {
        if (!prev[newId]) return prev;
        const next = { ...prev };
        delete next[newId];
        return next;
      });
    });
  };
  const removeCutlistActivity = (id: number) => {
    setCutlistActivityFeed((prev) => prev.filter((entry) => entry.id !== id));
    setCutlistActivityEnteringIds((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const warningTextForIssue = (issue: CutlistValidationIssue) => {
    const field = String(issue.field || "").toLowerCase();
    const msg = String(issue.message || "").toLowerCase();
    if (field === "board") return "Board: Required";
    if (field === "name") return "Part Name: Required";
    if (field === "quantity") return "Quantity: Required";
    if (field === "depth" && msg.includes("too small")) return "Depth: Too Small for Hardware";
    if (msg.includes("fill at least 2")) return "Dimensions: Fill at least 2";
    if (msg.includes("exceeds board sheet size")) {
      const title = field ? `${field.charAt(0).toUpperCase()}${field.slice(1)}` : "Dimension";
      return `${title}: Exceeds Sheet Size`;
    }
    if (field === "height") return "Height: Required";
    if (field === "width") return "Width: Required";
    if (field === "depth") return "Depth: Required";
    return issue.message;
  };
  const cutlistFieldLabel = (key: CutlistEditableField) => {
    if (key === "board") return "Board";
    if (key === "name") return "Part Name";
    if (key === "height") return "Height";
    if (key === "width") return "Width";
    if (key === "depth") return "Depth";
    if (key === "quantity") return "Quantity";
    if (key === "clashing") return "Clashing";
    if (key === "grain") return "Grain";
    return key;
  };
  const cutlistValueForActivity = (row: CutlistRow, key: CutlistEditableField) => {
    if (key === "board") return boardDisplayLabel(String(row.board || "").trim());
    if (key === "grain") return String(row.grainValue || "").trim();
    if (key === "clashing") {
      if (isCabinetryPartType(row.partType)) {
        const fs = String(row.fixedShelf || "").trim();
        const as = String(row.adjustableShelf || "").trim();
        const fd = normalizeDrillingValue(row.fixedShelfDrilling);
        const ad = normalizeDrillingValue(row.adjustableShelfDrilling);
        return `FS ${fs || "-"} (${fd}) | AS ${as || "-"} (${ad})`;
      }
      return joinClashing(String(row.clashLeft || ""), String(row.clashRight || "")) || String(row.clashing || "").trim();
    }
    return String(row[key] ?? "").trim();
  };
  const logCutlistValidationIssues = (issues: CutlistValidationIssue[], partType?: string) => {
    const seen = new Set<string>();
    for (const issue of issues) {
      const key = `warn:${String(issue.field || "").toLowerCase()}:${warningTextForIssue(issue)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      logCutlistActivity(warningTextForIssue(issue), {
        action: "Clear",
        actionKind: "clear",
        dedupeKey: key,
        partType: partType || "",
      });
    }
  };
  const clampCutlistActivityOffset = (value: number) => {
    const min = cutlistActivityMinOffsetRef.current;
    const max = cutlistActivityMaxOffsetRef.current;
    return Math.max(min, Math.min(max, value));
  };
  const setCutlistActivityOffsetClamped = (value: number) => {
    const next = clampCutlistActivityOffset(value);
    cutlistActivityOffsetRef.current = next;
    setCutlistActivityOffset(next);
  };
  const setCutlistActivityOffsetDomOnly = (value: number) => {
    const next = clampCutlistActivityOffset(value);
    cutlistActivityOffsetRef.current = next;
    cutlistActivityPendingOffsetRef.current = next;
    if (cutlistActivityRafRef.current != null) return;
    cutlistActivityRafRef.current = window.requestAnimationFrame(() => {
      cutlistActivityRafRef.current = null;
      const pending = cutlistActivityPendingOffsetRef.current;
      if (pending == null) return;
      const inner = cutlistActivityInnerRef.current;
      if (inner) inner.style.transform = `translate3d(${pending}px, 0, 0)`;
    });
  };
  const recalcCutlistActivityBounds = (alignLatest: boolean) => {
    const container = cutlistActivityScrollRef.current;
    const inner = cutlistActivityInnerRef.current;
    if (!container || !inner) return;
    const containerW = container.clientWidth || 0;
    const innerW = inner.scrollWidth || inner.offsetWidth || 0;
    const min = Math.min(0, containerW - innerW);
    cutlistActivityMinOffsetRef.current = min;
    cutlistActivityMaxOffsetRef.current = 0;
    if (alignLatest) {
      cutlistActivityOffsetRef.current = min;
      setCutlistActivityOffset(min);
      return;
    }
    setCutlistActivityOffsetClamped(cutlistActivityOffsetRef.current);
  };
  const onCutlistActivityPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!el) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-cutlist-activity-control='true']")) return;
    if (!cutlistActivityScrollRef.current) return;
    recalcCutlistActivityBounds(false);
    cutlistActivityDraggingRef.current = true;
    setCutlistActivityIsDragging(true);
    cutlistActivityActivePointerIdRef.current = e.pointerId;
    cutlistActivityDragStartXRef.current = e.clientX;
    cutlistActivityDragStartOffsetRef.current = cutlistActivityOffsetRef.current;
    el.style.cursor = "grabbing";
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
  };
  const endCutlistActivityPointerDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (cutlistActivityActivePointerIdRef.current !== null && e.pointerId !== cutlistActivityActivePointerIdRef.current) return;
    cutlistActivityDraggingRef.current = false;
    setCutlistActivityIsDragging(false);
    cutlistActivityActivePointerIdRef.current = null;
    const node = e.currentTarget;
    if (node) {
      node.style.cursor = "grab";
      try {
        node.releasePointerCapture(e.pointerId);
      } catch {}
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  useEffect(
    () => () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    [],
  );
  useEffect(() => {
    const onPointerMoveWindow = (ev: PointerEvent) => {
      if (!cutlistActivityDraggingRef.current) return;
      if (cutlistActivityActivePointerIdRef.current !== null && ev.pointerId !== cutlistActivityActivePointerIdRef.current) return;
      const dx = ev.clientX - cutlistActivityDragStartXRef.current;
      const target = cutlistActivityDragStartOffsetRef.current + dx;
      setCutlistActivityOffsetDomOnly(target);
      ev.preventDefault();
    };
    const onPointerUpWindow = (ev: PointerEvent) => {
      if (!cutlistActivityDraggingRef.current) return;
      if (cutlistActivityActivePointerIdRef.current !== null && ev.pointerId !== cutlistActivityActivePointerIdRef.current) return;
      cutlistActivityDraggingRef.current = false;
      setCutlistActivityIsDragging(false);
      const node = cutlistActivityScrollRef.current;
      if (node) {
        node.style.cursor = "grab";
        try {
          node.releasePointerCapture(ev.pointerId);
        } catch {}
      }
      setCutlistActivityOffset(cutlistActivityOffsetRef.current);
      cutlistActivityActivePointerIdRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onPointerMoveWindow, { passive: false });
    window.addEventListener("pointerup", onPointerUpWindow);
    window.addEventListener("pointercancel", onPointerUpWindow);
    return () => {
      if (cutlistActivityRafRef.current != null) {
        window.cancelAnimationFrame(cutlistActivityRafRef.current);
        cutlistActivityRafRef.current = null;
      }
      window.removeEventListener("pointermove", onPointerMoveWindow);
      window.removeEventListener("pointerup", onPointerUpWindow);
      window.removeEventListener("pointercancel", onPointerUpWindow);
    };
  }, []);
  const scrollCutlistActivityToLatest = () => {
    recalcCutlistActivityBounds(true);
  };
  const ensureCutlistActivityLatestVisible = () => {
    if (cutlistActivityDraggingRef.current) return;
    scrollCutlistActivityToLatest();
    window.setTimeout(scrollCutlistActivityToLatest, 0);
    window.setTimeout(scrollCutlistActivityToLatest, 80);
  };
  const isAnyFullscreenCutlistActivityView =
    (resolvedTab === "production" && productionAccess.view && productionNav === "cutlist") ||
    (resolvedTab === "sales" && salesAccess.view && salesNav === "initial");
  const activeFullscreenCutlistActivityFeedLength =
    resolvedTab === "production" && productionAccess.view && productionNav === "cutlist"
      ? cutlistActivityFeed.filter((entry) => (entry.scope || "production") === "production").length
      : resolvedTab === "sales" && salesAccess.view && salesNav === "initial"
        ? cutlistActivityFeed.filter((entry) => (entry.scope || "production") === "initial").length
        : 0;
  useEffect(() => {
    if (!isAnyFullscreenCutlistActivityView) return;
    ensureCutlistActivityLatestVisible();
  }, [isAnyFullscreenCutlistActivityView, activeFullscreenCutlistActivityFeedLength]);
  useEffect(() => {
    if (!isAnyFullscreenCutlistActivityView) return;
    const onResize = () => {
      recalcCutlistActivityBounds(false);
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [isAnyFullscreenCutlistActivityView]);
  const activeCutlistEntryColor = partTypeColors[cutlistEntry.partType] ?? "#CBD5E1";
  const activeCutlistEntryTextColor = isLightHex(activeCutlistEntryColor) ? "#1F2937" : "#F8FAFC";
  const activeCutlistEntryFieldBg = lightenHex(activeCutlistEntryColor, 0.12);
  const activeCutlistEntryFieldBorder = darkenHex(activeCutlistEntryColor, 0.2);
  const activeInitialCutlistEntryColor = partTypeColors[initialCutlistEntry.partType] ?? "#CBD5E1";
  const activeInitialCutlistEntryTextColor = isLightHex(activeInitialCutlistEntryColor) ? "#1F2937" : "#F8FAFC";
  const activeInitialCutlistEntryFieldBg = lightenHex(activeInitialCutlistEntryColor, 0.12);
  const activeInitialCutlistEntryFieldBorder = darkenHex(activeInitialCutlistEntryColor, 0.2);
  const productionCutlistActivityFeed = useMemo(
    () => cutlistActivityFeed.filter((entry) => (entry.scope || "production") === "production"),
    [cutlistActivityFeed],
  );
  const initialCutlistActivityFeed = useMemo(
    () => cutlistActivityFeed.filter((entry) => (entry.scope || "production") === "initial"),
    [cutlistActivityFeed],
  );

  const salesRooms = useMemo(() => {
    const base = salesRoomNames.length ? salesRoomNames : [];
    return Array.from(new Set(base.map((row) => String(row || "").trim()).filter(Boolean)));
  }, [salesRoomNames]);

  const cutlistRoomTabs = useMemo(() => {
    const fromRows = cutlistRows
      .map((row) => String(row.room || "").trim())
      .filter((v) => v && v !== "Project Cutlist");
    const mergedRooms = Array.from(new Set([...salesRooms, ...fromRows]));
    const tabs = mergedRooms.map((room) => ({ label: room, filter: room }));
    tabs.push({ label: "Project Cutlist", filter: "Project Cutlist" });
    return tabs;
  }, [cutlistRows, salesRooms]);

  const cutlistAddedRoomTabs = useMemo(
    () => cutlistRoomTabs.filter((tab) => tab.filter !== "Project Cutlist"),
    [cutlistRoomTabs],
  );

  const cutlistEntryRoomOptions = useMemo(
    () => Array.from(new Set(cutlistRoomTabs.map((tab) => tab.filter))),
    [cutlistRoomTabs],
  );
  const initialCutlistRoomTabs = useMemo(() => {
    const fromRows = initialCutlistRows
      .map((row) => String(row.room || "").trim())
      .filter((v) => v && v !== "Project Cutlist");
    const mergedRooms = Array.from(new Set([...salesRooms, ...fromRows]));
    const tabs = mergedRooms.map((room) => ({ label: room, filter: room }));
    tabs.push({ label: "Project Cutlist", filter: "Project Cutlist" });
    return tabs;
  }, [initialCutlistRows, salesRooms]);
  const initialCutlistAddedRoomTabs = useMemo(
    () => initialCutlistRoomTabs.filter((tab) => tab.filter !== "Project Cutlist"),
    [initialCutlistRoomTabs],
  );
  const initialCutlistEntryRoomOptions = useMemo(
    () =>
      Array.from(
        new Set(
          initialCutlistRoomTabs
            .map((tab) => tab.filter)
            .filter((value) => value && value !== "Project Cutlist"),
        ),
      ),
    [initialCutlistRoomTabs],
  );
  const productionPartNameSuggestionsByRoom = useMemo(() => {
    const out: Record<string, PartNameSuggestionOption[]> = {};
    const seenByRoom = new Map<string, Set<string>>();
    for (const row of initialCutlistRows) {
      const roomKey = String(row.room || "Project Cutlist").trim().toLowerCase() || "project cutlist";
      const name = String(row.name || "").trim();
      if (!name) continue;
      const nameKey = name.toLowerCase();
      const seen = seenByRoom.get(roomKey) ?? new Set<string>();
      if (seen.has(nameKey)) continue;
      seen.add(nameKey);
      seenByRoom.set(roomKey, seen);
      const partType = String(row.partType || "").trim();
      const color = partTypeColors[partType] ?? "#CBD5E1";
      const textColor = isLightHex(color) ? "#1F2937" : "#F8FAFC";
      if (!out[roomKey]) out[roomKey] = [];
      out[roomKey].push({ name, partType, color, textColor });
    }
    for (const key of Object.keys(out)) {
      out[key].sort((a, b) => a.name.localeCompare(b.name));
    }
    return out;
  }, [initialCutlistRows, partTypeColors]);
  const productionUsedPartNamesByRoom = useMemo(() => {
    const out: Record<string, Set<string>> = {};
    const add = (room: string, name: string) => {
      const roomKey = String(room || "").trim().toLowerCase() || "project cutlist";
      const normalizedName = String(name || "").trim().toLowerCase();
      if (!normalizedName) return;
      if (!out[roomKey]) out[roomKey] = new Set<string>();
      out[roomKey].add(normalizedName);
    };
    for (const row of cutlistRows) {
      add(row.room, row.name);
    }
    for (const row of cutlistDraftRows) {
      add(row.room, row.name);
    }
    add(cutlistEntryRoom, cutlistEntry.name);
    return out;
  }, [cutlistDraftRows, cutlistEntry.name, cutlistEntryRoom, cutlistRows]);
  const productionPartNameSuggestionsForRoom = (room: string, currentName?: string) => {
    const roomKey = String(room || "").trim().toLowerCase() || "project cutlist";
    const currentKey = String(currentName || "").trim().toLowerCase();
    const used = new Set(productionUsedPartNamesByRoom[roomKey] ?? []);
    if (currentKey) used.delete(currentKey);
    return (productionPartNameSuggestionsByRoom[roomKey] ?? []).filter(
      (option) => !used.has(option.name.trim().toLowerCase()),
    );
  };

  const defaultCutlistRoom = useMemo(
    () => cutlistEntryRoomOptions[0] ?? "Project Cutlist",
    [cutlistEntryRoomOptions],
  );
  const defaultInitialCutlistRoom = useMemo(
    () => initialCutlistEntryRoomOptions[0] ?? "Project Cutlist",
    [initialCutlistEntryRoomOptions],
  );

  const defaultClashingForPartType = (partType: string, boardLabel: string) => {
    const board = String(boardLabel || "").trim();
    if (board && boardLacquerFor(board)) {
      return { left: "", right: "" };
    }
    return partTypeAutoClashMap[String(partType || "").trim().toLowerCase()] ?? { left: "", right: "" };
  };

  const buildCabinetryDerivedPieces = (row: CutlistRow): CabinetryDerivedPiece[] => {
    const width = toNum(row.width);
    const height = toNum(row.height);
    const depth = toNum(row.depth);
    const thickness = boardThicknessFor(String(row.board || "").trim());
    const widthMinus2T = width - 2 * thickness;
    const depthMinusT = depth - thickness;
    const adjustableWidth = widthMinus2T - 1;
    const adjustableDepth = depthMinusT - 10;
    const mainQty = Math.max(1, Math.floor(toNum(row.quantity) || 1));
    const fixedBaseQty = Math.max(0, Math.floor(toNum(row.fixedShelf)));
    const adjustableBaseQty = Math.max(0, Math.floor(toNum(row.adjustableShelf)));

    const parts: CabinetryDerivedPiece[] = [
      {
        key: "top",
        partName: "Top",
        height: "",
        width: formatMm(widthMinus2T),
        depth: formatMm(depthMinusT),
        quantity: String(mainQty),
        ...autoClashByDominant(widthMinus2T, depthMinusT),
      },
      {
        key: "bottom",
        partName: "Bottom",
        height: "",
        width: formatMm(widthMinus2T),
        depth: formatMm(depthMinusT),
        quantity: String(mainQty),
        ...autoClashByDominant(widthMinus2T, depthMinusT),
      },
      {
        key: "left_side",
        partName: "Left Side",
        height: formatMm(height),
        width: "",
        depth: formatMm(depth),
        quantity: String(mainQty),
        ...autoClashByDominant(height, depth),
      },
      {
        key: "right_side",
        partName: "Right Side",
        height: formatMm(height),
        width: "",
        depth: formatMm(depth),
        quantity: String(mainQty),
        ...autoClashByDominant(height, depth),
      },
      {
        key: "back",
        partName: "Back",
        height: formatMm(height),
        width: formatMm(widthMinus2T),
        depth: "",
        quantity: String(mainQty),
        clashLeft: "",
        clashRight: "",
      },
    ];

    const fixedShelfQty = fixedBaseQty > 0 ? String(fixedBaseQty * mainQty) : "";
    const fixedShelfClash = fixedShelfQty ? autoClashByDominant(widthMinus2T, depthMinusT) : { clashLeft: "", clashRight: "" };
    parts.push({
      key: "fixed_shelf",
      partName: "Fixed Shelf",
      height: "",
      width: formatMm(widthMinus2T),
      depth: formatMm(depthMinusT),
      quantity: fixedShelfQty,
      ...fixedShelfClash,
    });
    const adjustableShelfQty = adjustableBaseQty > 0 ? String(adjustableBaseQty * mainQty) : "";
    const adjustableShelfClash = adjustableShelfQty ? autoClashByDominant(adjustableWidth, adjustableDepth) : { clashLeft: "", clashRight: "" };
    parts.push({
      key: "adjustable_shelf",
      partName: "Adjustable Shelf",
      height: "",
      width: formatMm(adjustableWidth),
      depth: formatMm(adjustableDepth),
      quantity: adjustableShelfQty,
      ...adjustableShelfClash,
    });

    return parts;
  };

  const toggleCabinetryRowExpand = (rowId: string) => {
    setExpandedCabinetryRows((prev) => ({ ...prev, [rowId]: !prev[rowId] }));
  };

  const selectedDrawerBreakdown = useMemo(() => {
    const selectedCategory = String(productionForm.hardware.hardwareCategory || defaultHardwareCategory()).trim();
    const categoryRow = hardwareRows.find((row) => row.name.toLowerCase() === selectedCategory.toLowerCase());
    const drawerOptions = categoryRow?.drawers ?? [];
    const categoryDefaultDrawer = drawerOptions.find((row) => row.isDefault)?.name ?? drawerOptions[0]?.name ?? "";
    const selectedDrawer = String(productionForm.hardware.newDrawerType || categoryDefaultDrawer).trim();
    const drawerRow =
      drawerOptions.find((row) => row.name.toLowerCase() === selectedDrawer.toLowerCase()) ??
      drawerOptions.find((row) => row.isDefault) ??
      drawerOptions[0];
    const letterValueMap: Record<string, string> = {};
    for (const opt of drawerRow?.heightOptions ?? []) {
      const token = String(opt.token || "").trim();
      if (!token) continue;
      const key = token.toLowerCase();
      letterValueMap[key] = sanitizeDerivedValue(opt.value) || token;
    }
    return {
      bottomsWidthMinus: drawerRow?.bottomsWidthMinus ?? null,
      bottomsDepthMinus: drawerRow?.bottomsDepthMinus ?? null,
      backsWidthMinus: drawerRow?.backsWidthMinus ?? null,
      hardwareLengths: (drawerRow?.hardwareLengths ?? []).slice().sort((a, b) => a - b),
      spaceRequirement: drawerRow?.spaceRequirement ?? null,
      letterValueMap,
    };
  }, [
    hardwareRows,
    productionForm.hardware.hardwareCategory,
    productionForm.hardware.newDrawerType,
  ]);
  const hasDrawerRowsInUse = useMemo(
    () => cutlistRows.some((row) => isDrawerPartType(String(row.partType || ""))),
    [cutlistRows, isDrawerPartType],
  );

  const buildDrawerDerivedPieces = (row: CutlistRow): DrawerDerivedPiece[] => {
    const widthVal = toNum(row.width);
    const depthVal = toNum(row.depth);
    const rawHeight = String(row.height || "").trim();
    let tokens = parseDrawerHeightTokens(rawHeight);
    if (!tokens.length && rawHeight) tokens = [rawHeight];
    if (!tokens.length) tokens = [""];

    const bottomQty = Math.max(1, tokens.length);
    let depthBase: number | null = depthVal > 0 ? depthVal : null;
    if (depthBase != null) {
      let depthForHardware = depthBase;
      if (selectedDrawerBreakdown.spaceRequirement != null) {
        depthForHardware = Math.max(0, depthForHardware - selectedDrawerBreakdown.spaceRequirement);
      }
      let roundedHardwareDepth = depthForHardware;
      if (selectedDrawerBreakdown.hardwareLengths.length) {
        const candidates = selectedDrawerBreakdown.hardwareLengths.filter((v) => v <= depthForHardware);
        if (candidates.length) roundedHardwareDepth = Math.max(...candidates);
      }
      depthBase = roundedHardwareDepth;
    }

    const bottomW =
      widthVal > 0 && selectedDrawerBreakdown.bottomsWidthMinus != null
        ? widthVal - selectedDrawerBreakdown.bottomsWidthMinus
        : widthVal > 0
          ? widthVal
          : null;
    const bottomD =
      depthBase != null && selectedDrawerBreakdown.bottomsDepthMinus != null
        ? depthBase - selectedDrawerBreakdown.bottomsDepthMinus
        : depthBase;
    const backW =
      widthVal > 0 && selectedDrawerBreakdown.backsWidthMinus != null
        ? widthVal - selectedDrawerBreakdown.backsWidthMinus
        : widthVal > 0
          ? widthVal
          : null;

    const pieces: DrawerDerivedPiece[] = [];
    pieces.push({
      key: "drawer_bottom",
      partName: "Bottom",
      height: "",
      width: bottomW != null ? formatMm(bottomW) : "",
      depth: bottomD != null ? formatMm(bottomD) : "",
      quantity: String(bottomQty),
      clashLeft: "",
      clashRight: "",
    });

    const grouped: Record<string, number> = {};
    for (const token of tokens) {
      const key = sanitizeDerivedValue(token);
      if (!key) continue;
      grouped[key] = (grouped[key] ?? 0) + 1;
    }
    for (const [token, count] of Object.entries(grouped)) {
      const tokenClean = sanitizeDerivedValue(token);
      const mappedFromSettings = sanitizeDerivedValue(
        selectedDrawerBreakdown.letterValueMap[tokenClean.toLowerCase()],
      );
      const mappedHeight = mappedFromSettings || tokenClean;
      const backHNum = toNum(mappedFromSettings || tokenClean);
      let clashLeft = "";
      let clashRight = "";
      if (backW != null && backW > 0 && backHNum > 0) {
        if (backW < backHNum) clashRight = "1S";
        else clashLeft = "1L";
      }
      pieces.push({
        key: `drawer_back_${tokenClean || "blank"}`,
        partName: tokenClean ? `Back (${tokenClean})` : "Back",
        height: mappedHeight,
        width: backW != null ? formatMm(backW) : "",
        depth: "",
        quantity: String(Math.max(1, count)),
        clashLeft,
        clashRight,
      });
    }
    return pieces;
  };

  const salesRoomSheetAnalysis = useMemo(() => {
    type FlatPiece = {
      id: string;
      row: CutlistRow;
      room: string;
      productName: string;
      width: number;
      height: number;
      area: number;
    };
    type SheetOption = {
      sheetSize: string;
      width: number;
      height: number;
      price: number;
    };
    type SheetPlacement = {
      piece: FlatPiece;
      x: number;
      y: number;
      w: number;
      h: number;
    };
    type SheetLayout = { index: number; placements: SheetPlacement[] };
    type RoomSheetBucket = {
      room: string;
      productName: string;
      option: SheetOption;
      pieces: FlatPiece[];
      usedLargerThanDefault: boolean;
    };
    type LargerSheetWarningEntry = {
      room: string;
      productName: string;
      sheetSize: string;
      sheetCount: number;
      addedToQuote: boolean;
    };

    const toPositiveNum = (v: unknown) => {
      const n = Number.parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const formatCurrencyValue = (value: number) =>
      new Intl.NumberFormat("en-NZ", {
        style: "currency",
        currency: "NZD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Math.max(0, value));
    const rawRoot = (companyDoc ?? {}) as Record<string, unknown>;
    const rawNested = ((rawRoot.nestingSettings ?? rawRoot.nesting) ?? {}) as Record<string, unknown>;
    const settings = {
      sheetHeight: Math.max(100, toNum(rawNested.sheetHeight ?? rawNested.h ?? 2440) || 2440),
      sheetWidth: Math.max(100, toNum(rawNested.sheetWidth ?? rawNested.w ?? 1220) || 1220),
      kerf: Math.max(0, toNum(rawNested.kerf ?? 5) || 5),
      margin: Math.max(0, toNum(rawNested.margin ?? 10) || 10),
    };
    const productMap = new Map(
      companySalesProductConfigs.map((row) => [
        row.name.trim().toLowerCase(),
        {
          defaultOption: row.defaultOption
            ? {
                sheetSize: row.defaultOption.sheetSize,
                width: row.defaultOption.width,
                height: row.defaultOption.height,
                price: row.defaultOption.price,
              }
            : null,
          options: row.options.map((option) => ({
            sheetSize: option.sheetSize,
            width: option.width,
            height: option.height,
            price: option.price,
          })),
        },
      ]),
    );

    const expandedRows: CutlistRow[] = [];
    for (const row of initialCutlistRows) {
      if (isCabinetryPartType(row.partType)) {
        const pieces = buildCabinetryDerivedPieces(row);
        for (const piece of pieces) {
          const qty = Math.max(0, Number.parseInt(String(piece.quantity || "0"), 10) || 0);
          if (qty <= 0) continue;
          expandedRows.push({
            ...row,
            id: `${row.id}__cab__${piece.key}`,
            name: piece.partName || row.name,
            parentName: String(row.name || ""),
            height: String(piece.height || ""),
            width: String(piece.width || ""),
            depth: String(piece.depth || ""),
            quantity: String(qty),
            clashing: joinClashing(String(piece.clashLeft || ""), String(piece.clashRight || "")),
            clashLeft: String(piece.clashLeft || ""),
            clashRight: String(piece.clashRight || ""),
            information: String(row.information || ""),
          });
        }
        continue;
      }

      if (isDrawerPartType(row.partType)) {
        const pieces = buildDrawerDerivedPieces(row);
        for (const piece of pieces) {
          const qty = Math.max(0, Number.parseInt(String(piece.quantity || "0"), 10) || 0);
          if (qty <= 0) continue;
          expandedRows.push({
            ...row,
            id: `${row.id}__drw__${piece.key}`,
            name: piece.partName || row.name,
            parentName: String(row.name || ""),
            height: String(piece.height || ""),
            width: String(piece.width || ""),
            depth: String(piece.depth || ""),
            quantity: String(qty),
            clashing: joinClashing(String(piece.clashLeft || ""), String(piece.clashRight || "")),
            clashLeft: String(piece.clashLeft || ""),
            clashRight: String(piece.clashRight || ""),
            information: String(row.information || ""),
          });
        }
        continue;
      }

      expandedRows.push(row);
    }

    const piecesByRoomAndSheet = new Map<string, RoomSheetBucket>();
    for (const row of expandedRows) {
      const room = String(row.room || "").trim();
      const productName = String(row.board || "").trim();
      if (!room || !productName) continue;
      const product = productMap.get(productName.toLowerCase());
      if (!product || !product.options.length) continue;

      const qty = Math.max(1, Number.parseInt(String(row.quantity || "1"), 10) || 1);
      const dimH = toPositiveNum(row.height);
      const dimW = toPositiveNum(row.width);
      const dimD = toPositiveNum(row.depth);
      const grainDim = toPositiveNum(row.grainValue);
      let width = dimW || dimD || 120;
      let height = dimH || dimD || 80;

      if (grainDim > 0) {
        const allDims = [dimH, dimW, dimD].filter((v) => v > 0);
        const hasGrainMatch = allDims.some((v) => Math.abs(v - grainDim) < 0.001);
        if (hasGrainMatch) {
          const crossCandidates = allDims.filter((v) => Math.abs(v - grainDim) >= 0.001);
          const cross = (crossCandidates.length ? Math.max(...crossCandidates) : 0) || dimW || dimH || dimD || 80;
          width = grainDim;
          height = cross;
        }
      }

      const fitsSheet = (option: SheetOption) => {
        const innerW = Math.max(80, option.width - settings.margin * 2);
        const innerH = Math.max(80, option.height - settings.margin * 2);
        return (width <= innerW && height <= innerH) || (height <= innerW && width <= innerH);
      };

      const defaultOption = product.defaultOption;
      const requiresLargerThanDefault = defaultOption ? !fitsSheet(defaultOption) : false;
      const chosenOption =
        (defaultOption && fitsSheet(defaultOption) ? defaultOption : null) ??
        product.options.find((option) => fitsSheet(option)) ??
        product.options[product.options.length - 1];
      if (!chosenOption) continue;

      const key = `${room.toLowerCase()}__${productName.toLowerCase()}__${chosenOption.sheetSize}`;
      const bucket = piecesByRoomAndSheet.get(key) ?? {
        room,
        productName,
        option: chosenOption,
        pieces: [],
        usedLargerThanDefault: requiresLargerThanDefault,
      };
      bucket.usedLargerThanDefault = bucket.usedLargerThanDefault || requiresLargerThanDefault;
      for (let i = 0; i < qty; i += 1) {
        bucket.pieces.push({
          id: `${row.id}_${i + 1}`,
          row,
          room,
          productName,
          width: Math.max(30, width),
          height: Math.max(24, height),
          area: Math.max(1, width * height),
        });
      }
      piecesByRoomAndSheet.set(key, bucket);
    }

    const priceByRoom: Record<string, number> = {};
    const largerSheetWarningEntries: LargerSheetWarningEntry[] = [];
    for (const bucket of piecesByRoomAndSheet.values()) {
      const sheetWidth = Math.max(200, bucket.option.width);
      const sheetHeight = Math.max(150, bucket.option.height);
      const innerW = Math.max(80, sheetWidth - settings.margin * 2);
      const innerH = Math.max(80, sheetHeight - settings.margin * 2);
      const kerf = Math.max(0, settings.kerf);
      const sorted = [...bucket.pieces].sort((a, b) => b.area - a.area);

      const sheets: SheetLayout[] = [];
      let current: SheetLayout = { index: 1, placements: [] };
      let x = 0;
      let y = 0;
      let rowMax = 0;

      const startNewSheet = () => {
        if (current.placements.length > 0) sheets.push(current);
        current = { index: sheets.length + 1, placements: [] };
        x = 0;
        y = 0;
        rowMax = 0;
      };

      for (const piece of sorted) {
        let w = piece.width;
        let h = piece.height;
        const grainLocked = toPositiveNum(piece.row.grainValue) > 0;

        if (!grainLocked) {
          const canNormalFit = w <= innerW && h <= innerH;
          const canRotatedFit = h <= innerW && w <= innerH;
          const preferLongOnSheetLong = innerW >= innerH ? h > w : w > h;

          if (canRotatedFit && (!canNormalFit || preferLongOnSheetLong)) {
            const nextW = h;
            const nextH = w;
            w = nextW;
            h = nextH;
          } else if (!canNormalFit && !canRotatedFit) {
            const normalOverflow = Math.max(0, w - innerW) + Math.max(0, h - innerH);
            const rotatedOverflow = Math.max(0, h - innerW) + Math.max(0, w - innerH);
            if (rotatedOverflow < normalOverflow) {
              const nextW = h;
              const nextH = w;
              w = nextW;
              h = nextH;
            }
          }
        }

        w = Math.min(w, innerW);
        h = Math.min(h, innerH);

        if (x > 0 && x + w > innerW) {
          x = 0;
          y += rowMax + kerf;
          rowMax = 0;
        }
        if (y > 0 && y + h > innerH) {
          startNewSheet();
        }
        if (x > 0 && x + w > innerW) {
          x = 0;
          y += rowMax + kerf;
          rowMax = 0;
        }
        if (y > 0 && y + h > innerH) {
          startNewSheet();
        }

        current.placements.push({ piece, x, y, w, h });
        x += w + kerf;
        rowMax = Math.max(rowMax, h);
      }

      if (current.placements.length > 0) sheets.push(current);
      const bucketCost = sheets.length * bucket.option.price;
      priceByRoom[bucket.room.toLowerCase()] = (priceByRoom[bucket.room.toLowerCase()] ?? 0) + bucketCost;
      if (bucket.usedLargerThanDefault && sheets.length > 0) {
        largerSheetWarningEntries.push({
          room: bucket.room,
          productName: bucket.productName,
          sheetSize: bucket.option.sheetSize,
          sheetCount: sheets.length,
          addedToQuote: true,
        });
      }
    }

    const out: Record<string, string> = {};
    for (const row of salesRoomRows) {
      const roomName = String(row.name || "").trim();
      const lower = roomName.toLowerCase();
      out[lower] = formatCurrencyValue(priceByRoom[lower] ?? 0);
    }
    return {
      pricingByRoom: out,
      largerSheetWarningEntries,
      largerSheetPricingAddedToQuote:
        largerSheetWarningEntries.length > 0 && largerSheetWarningEntries.every((entry) => entry.addedToQuote),
    };
  }, [
    buildCabinetryDerivedPieces,
    buildDrawerDerivedPieces,
    companySalesProductConfigs,
    initialCutlistRows,
    isCabinetryPartType,
    isDrawerPartType,
    companyDoc,
    salesRoomRows,
  ]);
  const salesRoomPricingByName = salesRoomSheetAnalysis.pricingByRoom;
  const initialMeasureLargerSheetWarningsByRoom = useMemo(() => {
    const grouped = new Map<string, Array<{ productName: string; sheetSize: string; sheetCount: number }>>();
    for (const entry of salesRoomSheetAnalysis.largerSheetWarningEntries) {
      const roomName = String(entry.room || "").trim() || "Project Cutlist";
      const list = grouped.get(roomName) ?? [];
      list.push({
        productName: String(entry.productName || "").trim(),
        sheetSize: String(entry.sheetSize || "").trim(),
        sheetCount: Math.max(0, Number(entry.sheetCount) || 0),
      });
      grouped.set(roomName, list);
    }
    return Array.from(grouped.entries()).map(([room, entries]) => ({
      room,
      entries,
    }));
  }, [salesRoomSheetAnalysis.largerSheetWarningEntries]);
  const displayedSalesRoomRows = useMemo(
    () =>
      salesRoomRows.map((row) => ({
        ...row,
        totalPrice: salesRoomPricingByName[String(row.name || "").trim().toLowerCase()] ?? "$0.00",
      })),
    [salesRoomPricingByName, salesRoomRows],
  );
  const displayedSalesRoomsTotal = useMemo(
    () =>
      displayedSalesRoomRows.reduce((sum, row) => {
        if (!row.included) return sum;
        const parsed = Number.parseFloat(String(row.totalPrice ?? "").replace(/[^0-9.-]/g, ""));
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0),
    [displayedSalesRoomRows],
  );
  const displayedSalesQuoteExtrasTotal = useMemo(
    () =>
      displayedSalesQuoteExtras.reduce((sum, row) => {
        if (!row.included) return sum;
        const parsed = Number.parseFloat(String(row.price ?? "").replace(/[^0-9.-]/g, ""));
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0),
    [displayedSalesQuoteExtras],
  );
  const displayedSalesQuoteGrandTotal = useMemo(
    () => displayedSalesRoomsTotal + displayedSalesQuoteExtrasTotal,
    [displayedSalesQuoteExtrasTotal, displayedSalesRoomsTotal],
  );
  const displayedSalesQuoteDiscountTotal = useMemo(() => {
    const rawTiers = Array.isArray((companyDoc as Record<string, unknown> | null)?.salesQuoteDiscountTiers)
      ? (((companyDoc as Record<string, unknown> | null)?.salesQuoteDiscountTiers) as Record<string, unknown>[])
      : [];
    for (const tier of rawTiers) {
      const low = parseCurrencyNumber(tier?.low);
      const high = parseCurrencyNumber(tier?.high);
      const discount = parseCurrencyNumber(tier?.discount);
      if (high <= 0 || discount <= 0) continue;
      if (displayedSalesQuoteGrandTotal >= low && displayedSalesQuoteGrandTotal <= high) {
        return formatCurrencyValue(discount);
      }
    }
    return formatCurrencyValue(0);
  }, [companyDoc, displayedSalesQuoteGrandTotal]);
  const salesMinusOffQuoteTotalEnabled = useMemo(
    () => Boolean((companyDoc as Record<string, unknown> | null)?.salesMinusOffQuoteTotal),
    [companyDoc],
  );
  const displayedSalesQuoteFinalTotal = useMemo(() => {
    if (!salesMinusOffQuoteTotalEnabled) return displayedSalesQuoteGrandTotal;
    return Math.max(0, displayedSalesQuoteGrandTotal - parseCurrencyNumber(displayedSalesQuoteDiscountTotal));
  }, [displayedSalesQuoteDiscountTotal, displayedSalesQuoteGrandTotal, salesMinusOffQuoteTotalEnabled]);
  const includedSalesRoomsForQuote = useMemo(
    () => displayedSalesRoomRows.filter((row) => Boolean(row.included)),
    [displayedSalesRoomRows],
  );
  const projectCreatorMember = useMemo(() => {
    if (!project) return null;

    const creatorUid = String(project.createdByUid ?? "").trim();
    if (creatorUid) {
      const byUid = companyMembers.find((member) => String(member.uid || "").trim() === creatorUid);
      if (byUid) return byUid;
    }

    const creatorNameKey = normalizePersonLookup(project.createdByName);
    if (!creatorNameKey) return null;

    return (
      companyMembers.find((member) => {
        const displayKey = normalizePersonLookup(member.displayName);
        const membershipKey = normalizePersonLookup(member.membershipDisplayName);
        const emailKey = normalizePersonLookup(String(member.email || "").split("@")[0] || "");
        return displayKey === creatorNameKey || membershipKey === creatorNameKey || emailKey === creatorNameKey;
      }) ?? null
    );
  }, [companyMembers, project]);
  const projectAssignedMember = useMemo(() => {
    if (!project) return null;

    const assignedUid = String(project.assignedToUid ?? "").trim();
    if (assignedUid) {
      const byUid = companyMembers.find((member) => String(member.uid || "").trim() === assignedUid);
      if (byUid) return byUid;
    }

    const assignedNameKey = normalizePersonLookup(project.assignedToName ?? project.assignedTo);
    if (!assignedNameKey) return null;

    return (
      companyMembers.find((member) => {
        const displayKey = normalizePersonLookup(member.displayName);
        const membershipKey = normalizePersonLookup(member.membershipDisplayName);
        const emailKey = normalizePersonLookup(String(member.email || "").split("@")[0] || "");
        return displayKey === assignedNameKey || membershipKey === assignedNameKey || emailKey === assignedNameKey;
      }) ?? null
    );
  }, [companyMembers, project]);
  const isCurrentProjectCreator = useMemo(
    () =>
      Boolean(
        user?.uid &&
          project?.createdByUid &&
          String(user.uid).trim() === String(project.createdByUid).trim(),
      ),
    [project?.createdByUid, user?.uid],
  );
  const quoteTemplateReplacements = useMemo<Record<string, string>>(() => {
    const companyName = toStr(
      companyDoc?.companyName ??
        companyDoc?.name ??
        ((companyDoc?.applicationPreferences as Record<string, unknown> | undefined)?.companyName ?? ""),
      "Company",
    );
    const clientAddress = toStr(project?.clientAddress, "-");
    const creatorName =
      toStr(projectCreatorMember?.displayName, "") || toStr(project?.createdByName, "-");
    const rawAssignedName = toStr(projectAssignedMember?.displayName, "") || toStr(project?.assignedToName, "");
    const fallbackAssignedName = toStr(project?.assignedTo, "");
    const assignedName =
      rawAssignedName ||
      (fallbackAssignedName && normalizePersonLookup(fallbackAssignedName) !== normalizePersonLookup(project?.createdByName)
        ? fallbackAssignedName
        : "");
    return {
      company_name: companyName,
      project_name: toStr(project?.name, "-"),
      client_name: toStr(project?.customer, "-"),
      client_first_name: toStr(project?.customer, "-").split(/\s+/).filter(Boolean)[0] || "-",
      client_phone: toStr(project?.clientPhone, "-"),
      client_email: toStr(project?.clientEmail, "-"),
      client_address: clientAddress,
      client_region: toStr(extractClientRegion(project?.clientAddress, project?.region), "-"),
      quote_generated_date: dashboardStyleDateOnly(new Date().toISOString()),
      date_generated: dashboardStyleDateOnly(new Date().toISOString()),
      project_creator: creatorName,
      project_creator_mobile: toStr(projectCreatorMember?.mobile, "-"),
      project_creator_email: toStr(projectCreatorMember?.email, "-"),
      project_assigned: toStr(assignedName, "-"),
      project_assigned_mobile: toStr(projectAssignedMember?.mobile, "-"),
      project_assigned_email: toStr(projectAssignedMember?.email, "-"),
      total_price: formatCurrencyValue(displayedSalesQuoteFinalTotal),
      quote_total: formatCurrencyValue(displayedSalesQuoteFinalTotal),
      discount_total: displayedSalesQuoteDiscountTotal,
      incl_gst: "(inc. G.S.T.)",
      project_notes: stripHtmlToPlainText(project?.notes),
      included_rooms: includedSalesRoomsForQuote.map((row) => row.name).join(", "),
      room_count: String(includedSalesRoomsForQuote.length),
      selected_products: selectedSalesProductNames.join(", "),
      product_count: String(selectedSalesProductNames.length),
    };
  }, [companyDoc, displayedSalesQuoteDiscountTotal, displayedSalesQuoteFinalTotal, includedSalesRoomsForQuote, project, projectAssignedMember, projectCreatorMember, selectedSalesProductNames]);
  const effectiveQuoteTemplateReplacements = useMemo(() => {
    const next = { ...quoteTemplateReplacements };
    disabledQuotePlaceholderKeySet.forEach((key) => {
      next[key] = "";
    });
    return next;
  }, [disabledQuotePlaceholderKeySet, quoteTemplateReplacements]);
  const persistQuoteProjectText = async (blockId: string, fullValue: string) => {
    if (!project) return;
    const trimmedValue = String(fullValue ?? "");
    const nextQuoteProjectText = { ...salesQuoteProjectText };
    if (trimmedValue.trim()) nextQuoteProjectText[blockId] = trimmedValue;
    else delete nextQuoteProjectText[blockId];
    const nextSales = {
      ...salesPayload,
      quoteProjectText: nextQuoteProjectText,
    } as Record<string, unknown>;
    const nextProjectSettings = {
      ...((project.projectSettings ?? {}) as Record<string, unknown>),
      sales: nextSales,
    };
    setIsSavingQuoteProjectText(true);
    const ok = await updateProjectPatch(project, {
      sales: nextSales,
      salesJson: JSON.stringify(nextSales),
      projectSettings: nextProjectSettings,
      projectSettingsJson: JSON.stringify(nextProjectSettings),
    });
    setIsSavingQuoteProjectText(false);
    if (!ok) return;
    setProject((prevProject) =>
      prevProject
        ? {
            ...prevProject,
            sales: nextSales as never,
            projectSettings: {
              ...(prevProject.projectSettings ?? {}),
              sales: nextSales,
            },
          }
        : prevProject,
    );
  };

  const insertSalesQuoteHelperAtCursor = (helper: SalesQuoteHelperRow) => {
    const activeBlockId = String(activeQuoteProjectTextEditBlockId ?? "").trim();
    if (!activeBlockId) return;
    const editor = quoteProjectTextRefs.current[activeBlockId];
    if (!editor || typeof document === "undefined") return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    const helperMarker = document.createElement("span");
    helperMarker.setAttribute("data-helper-insert-end", "true");
    helperMarker.style.display = "inline-block";
    helperMarker.style.width = "0";
    helperMarker.style.overflow = "hidden";
    const template = document.createElement("template");
    template.innerHTML = `${sanitizeQuoteRichTextMarkup(helper.content)}${helperMarker.outerHTML}`;
    const fragment = template.content;
    const nextLine = document.createElement("div");
    nextLine.setAttribute("data-helper-caret", "true");

    range.deleteContents();
    range.insertNode(fragment);
    const insertedMarker = editor.querySelector("[data-helper-insert-end='true']") as HTMLSpanElement | null;
    if (insertedMarker?.parentNode) {
      insertedMarker.parentNode.insertBefore(nextLine, insertedMarker.nextSibling);
      insertedMarker.remove();
    } else {
      editor.appendChild(nextLine);
    }

    if (nextLine) {
      const nextRange = document.createRange();
      nextRange.setStart(nextLine, 0);
      nextRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(nextRange);
      window.requestAnimationFrame(() => {
        const liveSelection = window.getSelection();
        if (!liveSelection) return;
        const liveRange = document.createRange();
        liveRange.setStart(nextLine, 0);
        liveRange.collapse(true);
        liveSelection.removeAllRanges();
        liveSelection.addRange(liveRange);
      });
    }

    const nextValue = sanitizeQuoteRichTextMarkup(editor.innerHTML);
    setQuoteProjectTextDrafts((prev) => ({ ...prev, [activeBlockId]: nextValue }));
  };

  const toggleDrawerRowExpand = (rowId: string) => {
    setExpandedDrawerRows((prev) => ({ ...prev, [rowId]: !prev[rowId] }));
  };

  const createDraftCutlistRow = (
    partType: string,
    room: string,
    seed?: Partial<CutlistDraftRow>,
  ): CutlistDraftRow => {
    const split = splitClashing(String(seed?.clashing ?? ""));
    const board = String(seed?.board ?? "");
    const defaults = defaultClashingForPartType(partType, board);
    const seededLeft = String(seed?.clashLeft ?? split.left ?? "").trim().toUpperCase();
    const seededRight = String(seed?.clashRight ?? split.right ?? "").trim().toUpperCase();
    const left = seededLeft || defaults.left;
    const right = seededRight || defaults.right;
    return {
      id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      room: room || "Project Cutlist",
      partType,
      board,
      name: String(seed?.name ?? ""),
      height: String(seed?.height ?? ""),
      width: String(seed?.width ?? ""),
      depth: String(seed?.depth ?? ""),
      quantity: String(seed?.quantity ?? ""),
      clashing: joinClashing(left, right),
      clashLeft: left,
      clashRight: right,
      fixedShelf: String(seed?.fixedShelf ?? ""),
      adjustableShelf: String(seed?.adjustableShelf ?? ""),
      fixedShelfDrilling: normalizeDrillingValue(seed?.fixedShelfDrilling),
      adjustableShelfDrilling: normalizeDrillingValue(seed?.adjustableShelfDrilling),
      information: String(seed?.information ?? ""),
      grain: Boolean(seed?.grain ?? false),
      grainValue: String(seed?.grainValue ?? ""),
    };
  };

  const onChangeTab = (value: string) => {
    if (value === "sales" && !salesAccess.view) {
      setLockMessage("Sales is locked for your role on this project.");
      return;
    }
    if (value === "production" && !productionAccess.view) {
      setLockMessage("Production is locked for your role on this project.");
      return;
    }
    if (value === "settings" && !settingsAccess.view) {
      setLockMessage("Settings is locked for your role on this project.");
      return;
    }
    setLockMessage("");
    if (value === "production") {
      setProductionNav("overview");
      setNestingFullscreen(false);
    }
    const projectId = params.projectId;
    if (!projectId) {
      return;
    }
    router.replace(`/projects/${projectId}?tab=${value}`);
  };

  useEffect(() => {
    const projectId = params.projectId;
    const load = async () => {
        if (!projectId) {
          setProject(null);
          setChanges([]);
          setQuotes([]);
          setIsLoading(false);
          return;
        }

        const storedCompanyId =
          typeof window !== "undefined"
            ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
            : "";
        const preferredCompanyIds = [storedCompanyId, String(user?.companyId || "").trim()].filter(Boolean);

        const [projectItem, changeItems, quoteItems] = await Promise.all([
          fetchProjectById(projectId, user?.uid, preferredCompanyIds),
          fetchChanges(projectId),
          fetchQuotes(),
        ]);

      setProject(projectItem);
      setGeneralDetailsDraft({
        customer: String(projectItem?.customer ?? ""),
        clientPhone: String(projectItem?.clientPhone ?? ""),
        clientEmail: String(projectItem?.clientEmail ?? ""),
        clientAddress: String(projectItem?.clientAddress ?? ""),
        notes: String(projectItem?.notes ?? ""),
      });
      setProjectTags(Array.isArray(projectItem?.tags) ? projectItem.tags.slice(0, 5) : []);
      setChanges(changeItems);
      setQuotes(quoteItems.filter((item) => item.projectId === projectId));
      setIsLoading(false);
    };

    void load();
  }, [params.projectId, user?.uid]);

  useEffect(() => {
    const loadAccess = async () => {
      if (!project?.companyId || !user?.uid) {
        setCompanyAccess(null);
        return;
      }
      const access = await fetchCompanyAccess(project.companyId, user.uid);
      setCompanyAccess(access);
    };
    void loadAccess();
  }, [project?.companyId, user?.uid]);

  useEffect(() => {
    if (!project) return;
    setGeneralDetailsDraft((prev) => ({
      customer: isEditingClientDetails ? prev.customer : String(project.customer ?? ""),
      clientPhone: isEditingClientDetails ? prev.clientPhone : String(project.clientPhone ?? ""),
      clientEmail: isEditingClientDetails ? prev.clientEmail : String(project.clientEmail ?? ""),
      clientAddress: isEditingClientDetails ? prev.clientAddress : String(project.clientAddress ?? ""),
      notes: isEditingNotes ? prev.notes : String(project.notes ?? ""),
    }));
  }, [
    project?.customer,
    project?.clientPhone,
    project?.clientEmail,
    project?.clientAddress,
    project?.notes,
    isEditingClientDetails,
    isEditingNotes,
  ]);


  useEffect(() => {
    const loadCompanyDoc = async () => {
      if (!project?.companyId) {
        setCompanyDoc(null);
        return;
      }
      const hit = await fetchCompanyDoc(project.companyId);
      setCompanyDoc(hit);
    };
    void loadCompanyDoc();
  }, [project?.companyId]);

  useEffect(() => {
    const loadCompanyMembers = async () => {
      if (!project?.companyId) {
        setCompanyMembers([]);
        return;
      }
      const members = await fetchCompanyMembers(project.companyId);
      setCompanyMembers(members);
    };
    void loadCompanyMembers();
  }, [project?.companyId]);

  useEffect(() => {
    const loadImages = async () => {
      const refs = collectProjectImageRefs(project);
      if (!refs.length) {
        setProjectImageUrls([]);
        return;
      }
      const resolved = await Promise.all(refs.map((item) => resolveProjectImageUrl(item)));
      setProjectImageUrls(Array.from(new Set(resolved.filter(Boolean))));
    };
    void loadImages();
  }, [project?.id, project?.projectImages, project?.projectFiles]);

  useEffect(() => {
    const loadFiles = async () => {
      const entries = normalizeProjectFileEntries(project).filter((row) => !isProjectFileImageLike({
        name: row.name,
        path: row.path,
        url: row.url,
        contentType: row.contentType,
      }));
      if (!entries.length) {
        setProjectFiles([]);
        return;
      }
      const resolved = await Promise.all(
        entries.map(async (row) => {
          const url = await resolveProjectFileUrl(row);
          return { ...row, url: row.url || url };
        }),
      );
      setProjectFiles(resolved);
    };
    void loadFiles();
  }, [project?.id, project?.projectFiles]);

  useEffect(() => {
    setSelectedProjectImageIndex((prev) => {
      if (projectImageUrls.length === 0) return 0;
      if (prev < 0) return 0;
      if (prev >= projectImageUrls.length) return projectImageUrls.length - 1;
      return prev;
    });
  }, [projectImageUrls]);

  useEffect(() => {
    setSelectedProjectFileIndex((prev) => {
      if (projectFiles.length === 0) return 0;
      if (prev < 0) return 0;
      if (prev >= projectFiles.length) return projectFiles.length - 1;
      return prev;
    });
  }, [projectFiles]);

  useEffect(() => {
    const allowed = new Set(projectFiles.map((row) => row.id));
    setSelectedProjectFileIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [projectFiles]);

  const onUploadProjectImages = async (files: FileList | null) => {
    if (!files || !project) return;
    const storageClient = storage;
    if (!storageClient || !project.companyId) {
      setLockMessage("Image upload is unavailable.");
      return;
    }
    if (isUploadingProjectImages) return;

    const existing = collectProjectImageRefs(project);
    const room = Math.max(0, 5 - existing.length);
    if (room <= 0) {
      setLockMessage("Maximum 5 images allowed.");
      return;
    }

    const incoming = Array.from(files).filter((file) => String(file.type || "").toLowerCase().startsWith("image/"));
    const picked = incoming.slice(0, room);
    if (!picked.length) return;

    setIsUploadingProjectImages(true);
    setProjectImageUploadProgress(0);
    try {
      const perFileProgress = new Array(picked.length).fill(0);
      const pushAggregateProgress = () => {
        const total = perFileProgress.reduce((sum, v) => sum + v, 0);
        const avg = picked.length > 0 ? total / picked.length : 0;
        setProjectImageUploadProgress(Math.max(0, Math.min(100, Math.round(avg))));
      };
      const uploaded = await Promise.all(
        picked.map(async (file, idx) => {
          try {
            const extRaw = file.name.includes(".") ? String(file.name.split(".").pop() || "jpg").trim() : "jpg";
            const ext = extRaw.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
            const path = `companies/${project.companyId}/jobs/${project.id}/images/${Date.now()}_${idx + 1}.${ext}`;
            const ref = storageRef(storageClient, path);
            const task = uploadBytesResumable(ref, file, { contentType: file.type || "image/jpeg" });
            await new Promise<void>((resolve, reject) => {
              task.on(
                "state_changed",
                (snapshot) => {
                  const fraction = snapshot.totalBytes > 0 ? snapshot.bytesTransferred / snapshot.totalBytes : 0;
                  perFileProgress[idx] = Math.round(fraction * 100);
                  pushAggregateProgress();
                },
                () => reject(new Error("upload-failed")),
                () => resolve(),
              );
            });
            perFileProgress[idx] = 100;
            pushAggregateProgress();
            return await getDownloadURL(task.snapshot.ref);
          } catch {
            return "";
          }
        }),
      );
      const next = [...existing, ...uploaded.filter(Boolean)].slice(0, 5);
      const ok = await updateProjectPatch(project, { projectImages: next });
      if (!ok) {
        setLockMessage("Could not save uploaded image references.");
        return;
      }
      setProject((prev) => (prev ? { ...prev, projectImages: next } : prev));
      setProjectImageUrls(Array.from(new Set(next.filter(Boolean))));
      setSelectedProjectImageIndex(Math.max(0, next.length - 1));
      setLockMessage("");
    } catch {
      setLockMessage("Could not upload images.");
    } finally {
      setIsUploadingProjectImages(false);
      setProjectImageUploadProgress(0);
    }
  };

  const onUploadProjectFiles = async (files: FileList | null) => {
    if (!files || !project) return;
    const storageClient = storage;
    if (!storageClient || !project.companyId) {
      setLockMessage("File upload is unavailable.");
      return;
    }
    if (isUploadingProjectFiles) return;

    const existing = normalizeProjectFileEntries(project).filter((row) => !isProjectFileImageLike({
      name: row.name,
      path: row.path,
      url: row.url,
      contentType: row.contentType,
    }));
    const existingTotal = existing.reduce((sum, row) => sum + Math.max(0, Number(row.size) || 0), 0);
    const maxTotal = PROJECT_FILE_TOTAL_LIMIT_BYTES;
    if (existingTotal >= maxTotal) {
      setLockMessage("Maximum total file size reached (10MB).");
      return;
    }

    const incoming = Array.from(files).filter((file) => {
      const type = String(file.type || "").toLowerCase();
      if (type.startsWith("image/")) return false;
      const ext = extensionFromPathLike(file.name);
      return PROJECT_FILE_ACCEPT_EXTENSIONS.includes(ext);
    });
    if (!incoming.length) {
      setLockMessage("Select supported non-image files (PDF, DOCX, XLSX, TXT, etc).");
      return;
    }

    const allowed: File[] = [];
    let used = existingTotal;
    for (const file of incoming) {
      if (used + file.size > maxTotal) break;
      allowed.push(file);
      used += file.size;
    }
    if (!allowed.length) {
      const remaining = Math.max(0, maxTotal - existingTotal);
      setLockMessage(`No upload room left. Remaining: ${formatBytes(remaining)}.`);
      return;
    }

    setIsUploadingProjectFiles(true);
    setProjectFileUploadProgress(0);
    try {
      const perFileProgress = new Array(allowed.length).fill(0);
      const pushAggregateProgress = () => {
        const total = perFileProgress.reduce((sum, v) => sum + v, 0);
        const avg = allowed.length > 0 ? total / allowed.length : 0;
        setProjectFileUploadProgress(Math.max(0, Math.min(100, Math.round(avg))));
      };

      const uploaded = await Promise.all(
        allowed.map(async (file, idx) => {
          try {
            const ext = extensionFromPathLike(file.name) || "bin";
            const baseName = String(file.name || `file_${idx + 1}`)
              .replace(/\.[^/.]+$/, "")
              .replace(/[^a-zA-Z0-9_-]/g, "_")
              .slice(0, 80);
            const safeName = `${baseName || `file_${idx + 1}`}.${ext}`;
            const path = `companies/${project.companyId}/jobs/${project.id}/files/${Date.now()}_${idx + 1}_${safeName}`;
            const ref = storageRef(storageClient, path);
            const task = uploadBytesResumable(ref, file, { contentType: file.type || "application/octet-stream" });
            await new Promise<void>((resolve, reject) => {
              task.on(
                "state_changed",
                (snapshot) => {
                  const fraction = snapshot.totalBytes > 0 ? snapshot.bytesTransferred / snapshot.totalBytes : 0;
                  perFileProgress[idx] = Math.round(fraction * 100);
                  pushAggregateProgress();
                },
                () => reject(new Error("upload-failed")),
                () => resolve(),
              );
            });
            perFileProgress[idx] = 100;
            pushAggregateProgress();
            const url = await getDownloadURL(task.snapshot.ref);
            return {
              id: `pf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: file.name,
              path,
              url,
              size: file.size,
              contentType: file.type || "application/octet-stream",
              uploadedAtIso: new Date().toISOString(),
            } as ProjectFileEntry;
          } catch {
            return null;
          }
        }),
      );

      const nextFiles = [...existing, ...uploaded.filter(Boolean) as ProjectFileEntry[]];
      const ok = await updateProjectPatch(project, {
        projectFiles: nextFiles.map((row) => ({
          id: row.id,
          name: row.name,
          path: row.path,
          url: row.url,
          size: row.size,
          contentType: row.contentType,
          uploadedAtIso: row.uploadedAtIso,
        })),
      });
      if (!ok) {
        setLockMessage("Could not save uploaded files.");
        return;
      }
      setProject((prev) =>
        prev
          ? {
              ...prev,
              projectFiles: nextFiles.map((row) => ({
                id: row.id,
                name: row.name,
                path: row.path,
                url: row.url,
                size: row.size,
                contentType: row.contentType,
                uploadedAtIso: row.uploadedAtIso,
              })),
            }
          : prev,
      );
      setProjectFiles(nextFiles);
      setSelectedProjectFileIndex(Math.max(0, nextFiles.length - 1));
      setLockMessage("");
    } catch {
      setLockMessage("Could not upload files.");
    } finally {
      setIsUploadingProjectFiles(false);
      setProjectFileUploadProgress(0);
    }
  };

  const projectImageAreaHeight = Math.max(420, projectImageMeasuredHeight || 0);

  const clampProjectImagePan = (x: number, y: number, zoomLevel = projectImageZoom) => {
    const viewport = projectImageViewportRef.current;
    const image = projectImagePreviewRef.current;
    if (!viewport || !image || zoomLevel <= 1) return { x: 0, y: 0 };
    const viewportW = viewport.clientWidth;
    const viewportH = viewport.clientHeight;
    const imageW = image.clientWidth;
    const imageH = image.clientHeight;
    const maxX = Math.max(0, (imageW * zoomLevel - viewportW) / 2);
    const maxY = Math.max(0, (imageH * zoomLevel - viewportH) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  const onProjectImagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (projectImageZoom <= 1 || e.button !== 0) return;
    const next = projectImageDragRef.current;
    next.active = true;
    next.pointerId = e.pointerId;
    next.startX = e.clientX;
    next.startY = e.clientY;
    next.originX = projectImagePan.x;
    next.originY = projectImagePan.y;
    setProjectImageDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onProjectImagePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = projectImageDragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId || projectImageZoom <= 1) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const clamped = clampProjectImagePan(drag.originX + dx, drag.originY + dy, projectImageZoom);
    setProjectImagePan(clamped);
  };

  const onProjectImagePointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = projectImageDragRef.current;
    if (drag.pointerId !== e.pointerId) return;
    drag.active = false;
    drag.pointerId = null;
    setProjectImageDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // no-op
    }
  };

  const onProjectImageWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // Only Alt+wheel should control image zoom.
    // All other wheel input should pass through and scroll the page normally.
    if (!e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.nativeEvent.stopImmediatePropagation === "function") {
      e.nativeEvent.stopImmediatePropagation();
    }
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    const nextZoom = Math.max(1, Math.min(5, Number((projectImageZoom + delta).toFixed(2))));
    setProjectImageZoom(nextZoom);
    if (nextZoom <= 1) {
      setProjectImagePan({ x: 0, y: 0 });
    } else {
      const clamped = clampProjectImagePan(projectImagePan.x, projectImagePan.y, nextZoom);
      setProjectImagePan(clamped);
    }
  };

  useEffect(() => {
    const el = projectImageThumbsRef.current;
    if (!el) return;
    const update = () => {
      const h = Math.ceil(el.scrollHeight || el.getBoundingClientRect().height);
      setProjectImageMeasuredHeight(h > 0 ? h : 0);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect();
  }, [projectImageUrls.length]);

  useEffect(() => {
    const onGlobalWheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      // Lock page scrolling whenever Alt is held.
      e.preventDefault();
    };
    window.addEventListener("wheel", onGlobalWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onGlobalWheel, { capture: true } as EventListenerOptions);
  }, []);

  useEffect(() => {
    setProjectImageZoom(1);
    setProjectImagePan({ x: 0, y: 0 });
    setProjectImageDragging(false);
    projectImageDragRef.current.active = false;
    projectImageDragRef.current.pointerId = null;
  }, [selectedProjectImageIndex]);

  useEffect(() => {
    if (projectImageZoom <= 1) return;
    const clamped = clampProjectImagePan(projectImagePan.x, projectImagePan.y, projectImageZoom);
    if (clamped.x !== projectImagePan.x || clamped.y !== projectImagePan.y) {
      setProjectImagePan(clamped);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectImageAreaHeight, projectImageZoom]);

  const onDeleteSelectedProjectImage = async () => {
    if (!project || !generalAccess.edit || isUploadingProjectImages || isDeletingProjectImage) return;
    if (projectImageUrls.length === 0) {
      setLockMessage("Select an image first.");
      return;
    }
    const selectedUrl = projectImageUrls[selectedProjectImageIndex] || "";
    if (!selectedUrl) return;
    setIsDeletingProjectImage(true);
    try {
      const existingRefs = collectProjectImageRefs(project);
      let removeIdx = -1;
      for (let i = 0; i < existingRefs.length; i += 1) {
        const src = String(existingRefs[i] || "").trim();
        if (!src) continue;
        if (src === selectedUrl) {
          removeIdx = i;
          break;
        }
        const resolved = await resolveProjectImageUrl(src);
        if (resolved === selectedUrl) {
          removeIdx = i;
          break;
        }
      }
      if (removeIdx < 0) {
        setLockMessage("Could not find selected image source.");
        return;
      }

      const sourceToDelete = String(existingRefs[removeIdx] || "").trim();
      if (storage && sourceToDelete) {
        try {
          const normalized = /^https?:\/\//i.test(sourceToDelete) ? sourceToDelete : sourceToDelete.replace(/^\/+/, "");
          await deleteObject(storageRef(storage, normalized));
        } catch {
          // Deleting the storage object can fail for legacy/URL-only refs; continue removing reference.
        }
      }

      const nextRefs = existingRefs.filter((_, i) => i !== removeIdx);
      const ok = await updateProjectPatch(project, { projectImages: nextRefs });
      if (!ok) {
        setLockMessage("Could not delete selected image.");
        return;
      }

      const nextResolved = (
        await Promise.all(
          nextRefs.map(async (raw) => {
            try {
              return await resolveProjectImageUrl(raw);
            } catch {
              return "";
            }
          }),
        )
      ).filter(Boolean);
      setProject((prev) => (prev ? { ...prev, projectImages: nextRefs } : prev));
      setProjectImageUrls(Array.from(new Set(nextResolved)));
      setSelectedProjectImageIndex((prev) => {
        if (nextResolved.length === 0) return 0;
        return Math.max(0, Math.min(prev, nextResolved.length - 1));
      });
      setLockMessage("");
    } catch {
      setLockMessage("Could not delete selected image.");
    } finally {
      setIsDeletingProjectImage(false);
    }
  };

  const onDeleteSelectedProjectFile = async () => {
    if (!project || !generalAccess.edit || isUploadingProjectFiles || isDeletingProjectFile) return;
    if (projectFiles.length === 0) {
      setLockMessage("Select a file first.");
      return;
    }
    const selected = projectFiles[selectedProjectFileIndex];
    const selectedIdsSet = new Set(selectedProjectFileIds);
    const deleteMode = selectedIdsSet.size > 0 ? "multi" : "single";
    if (deleteMode === "single" && !selected) return;

    setIsDeletingProjectFile(true);
    try {
      const existing = normalizeProjectFileEntries(project).filter((row) => !isProjectFileImageLike({
        name: row.name,
        path: row.path,
        url: row.url,
        contentType: row.contentType,
      }));

      const matchesSelected = (row: ProjectFileEntry): boolean => {
        if (selectedIdsSet.size > 0) {
          return selectedIdsSet.has(row.id);
        }
        return Boolean(
          selected &&
            (row.id === selected.id ||
              (row.path && row.path === selected.path) ||
              (row.url && row.url === selected.url)),
        );
      };

      const filesToDelete = existing.filter(matchesSelected);
      if (!filesToDelete.length) {
        setLockMessage("Could not find selected file source.");
        return;
      }

      const storageClient = storage;
      if (storageClient) {
        await Promise.all(
          filesToDelete.map(async (row) => {
            const sourceToDelete = String(row.path || row.url || "").trim();
            if (!sourceToDelete) return;
            try {
              const normalized = /^https?:\/\//i.test(sourceToDelete) ? sourceToDelete : sourceToDelete.replace(/^\/+/, "");
              await deleteObject(storageRef(storageClient, normalized));
            } catch {
              // ignore storage delete failures and still remove reference
            }
          }),
        );
      }

      const nextFiles = existing.filter((row) => !matchesSelected(row));
      const ok = await updateProjectPatch(project, {
        projectFiles: nextFiles.map((row) => ({
          id: row.id,
          name: row.name,
          path: row.path,
          url: row.url,
          size: row.size,
          contentType: row.contentType,
          uploadedAtIso: row.uploadedAtIso,
        })),
      });
      if (!ok) {
        setLockMessage("Could not delete selected file.");
        return;
      }

      setProject((prev) =>
        prev
          ? {
              ...prev,
              projectFiles: nextFiles.map((row) => ({
                id: row.id,
                name: row.name,
                path: row.path,
                url: row.url,
                size: row.size,
                contentType: row.contentType,
                uploadedAtIso: row.uploadedAtIso,
              })),
            }
          : prev,
      );
      setProjectFiles(nextFiles);
      setSelectedProjectFileIds([]);
      setSelectedProjectFileIndex((prev) => {
        if (nextFiles.length === 0) return 0;
        return Math.max(0, Math.min(prev, nextFiles.length - 1));
      });
      setLockMessage("");
    } catch {
      setLockMessage("Could not delete selected file.");
    } finally {
      setIsDeletingProjectFile(false);
    }
  };

  const showPrevProjectImage = () => {
    if (projectImageUrls.length <= 1) return;
    setSelectedProjectImageIndex((prev) => {
      const total = projectImageUrls.length;
      if (total <= 0) return 0;
      return (prev - 1 + total) % total;
    });
  };

  const showNextProjectImage = () => {
    if (projectImageUrls.length <= 1) return;
    setSelectedProjectImageIndex((prev) => {
      const total = projectImageUrls.length;
      if (total <= 0) return 0;
      return (prev + 1) % total;
    });
  };

  useEffect(() => {
    if (!project) return;
    const raw = (project.projectSettings ?? {}) as Record<string, unknown>;
    const boardTypesRaw = Array.isArray(raw.boardTypes) ? raw.boardTypes : [];
    const hardwareCategory = toStr(raw.hardwareCategory) || defaultHardwareCategory();
    const boardRows: ProductionBoardRow[] = boardTypesRaw
      .filter((row) => row && typeof row === "object")
      .map((row, index) => {
        const item = row as Record<string, unknown>;
        return {
          id: `${project.id}_${index}_${Math.random().toString(36).slice(2, 6)}`,
          colour: toStr(item.colour ?? item.color),
          thickness: toStr(item.thickness),
          finish: toStr(item.finish),
          edging: toStr(item.edging, "Matching"),
          grain: Boolean(item.grain),
          lacquer: Boolean(item.lacquer),
          sheetSize: toStr(item.sheetSize ?? item.sheetSizeHw, defaultSheetSize()),
          sheets: toStr(item.sheets),
          edgetape: toStr(item.edgetape),
        };
      });

    const resolvedCategory = hardwareCategory || defaultHardwareCategory();
    const resolvedDrawer = toStr(raw.newDrawerType) || defaultDrawerForCategory(resolvedCategory);
    const resolvedHinge = toStr(raw.hingeType) || resolvedCategory;

    setProductionForm({
      existing: {
        carcassThickness: toStr(raw.carcassThickness),
        panelThickness: toStr(raw.panelThickness),
        frontsThickness: toStr(raw.frontsThickness),
      },
      cabinetry: {
        baseCabHeight: toStr(raw.baseCabHeight),
        footDistanceBack: toStr(raw.footDistanceBack),
        tallCabHeight: toStr(raw.tallCabHeight),
        footHeight: toStr(raw.footHeight),
        hobCentre: toStr(raw.hobCentre),
        hobSide: toStr(raw.hobSide),
      },
      hardware: {
        hardwareCategory: resolvedCategory,
        newDrawerType: resolvedDrawer,
        hingeType: resolvedHinge,
      },
      boardTypes: boardRows,
    });

    const miscRaw = raw.orderMiscDraftByCategory;
    const miscByCategory: Record<string, Record<string, OrderMiscDraftRow>> = {};
    if (miscRaw && typeof miscRaw === "object" && !Array.isArray(miscRaw)) {
      for (const [categoryKey, categoryValue] of Object.entries(miscRaw as Record<string, unknown>)) {
        if (!categoryValue || typeof categoryValue !== "object" || Array.isArray(categoryValue)) continue;
        const categoryRows: Record<string, OrderMiscDraftRow> = {};
        for (const [lineKey, lineValue] of Object.entries(categoryValue as Record<string, unknown>)) {
          if (!lineValue || typeof lineValue !== "object" || Array.isArray(lineValue)) continue;
          const lineObj = lineValue as Record<string, unknown>;
          categoryRows[String(lineKey || "").trim().toLowerCase()] = {
            name: toStr(lineObj.name),
            notes: toStr(lineObj.notes),
            qty: toStr(lineObj.qty),
            deleted: Boolean(lineObj.deleted),
          };
        }
        miscByCategory[String(categoryKey || "").trim().toLowerCase()] = categoryRows;
      }
    }
    setOrderMiscDraftByCategory(miscByCategory);
    const hingeRowsRaw = raw.orderHingeRowsByCategory;
    const hingeRowsByCategory: Record<string, OrderHingeRow[]> = {};
    if (hingeRowsRaw && typeof hingeRowsRaw === "object" && !Array.isArray(hingeRowsRaw)) {
      for (const [categoryKey, categoryValue] of Object.entries(hingeRowsRaw as Record<string, unknown>)) {
        if (!Array.isArray(categoryValue)) continue;
        hingeRowsByCategory[String(categoryKey || "").trim().toLowerCase()] = categoryValue
          .filter((row) => row && typeof row === "object")
          .map((row) => {
            const item = row as Record<string, unknown>;
            return {
              id: toStr(item.id) || `ord_hinge_${Math.random().toString(36).slice(2, 8)}`,
              name: toStr(item.name),
              qty: toStr(item.qty),
            };
          });
      }
    }
    setOrderHingeRowsByCategory(hingeRowsByCategory);
  }, [project?.id, boardThicknessOptions, boardFinishOptions, sheetSizeOptions, hardwareRows]);
  useEffect(() => {
    orderMiscDraftByCategoryRef.current = orderMiscDraftByCategory;
  }, [orderMiscDraftByCategory]);
  useEffect(() => {
    orderHingeRowsByCategoryRef.current = orderHingeRowsByCategory;
  }, [orderHingeRowsByCategory]);

  useEffect(() => {
    const loadMembers = async () => {
      if (!project?.companyId) {
        setUnlockMembers([]);
        setUnlockTargetUid("");
        return;
      }
      const members = await fetchCompanyMembers(project.companyId);
      const filtered = members.filter((m) => m.uid !== user?.uid);
      setUnlockMembers(filtered);
      if (filtered.length && !filtered.some((m) => m.uid === unlockTargetUid)) {
        setUnlockTargetUid(filtered[0].uid);
      }
    };
    void loadMembers();
  }, [project?.companyId, unlockTargetUid, user?.uid]);

  useEffect(() => {
    return () => {
      if (cutlistFlashTimeoutRef.current) {
        window.clearTimeout(cutlistFlashTimeoutRef.current);
      }
      if (cutlistFlashIntervalRef.current) {
        window.clearInterval(cutlistFlashIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const loadCutlist = async () => {
      if (!project?.id) {
        setProductionCutlist(null);
        setCutlistRows([]);
        return;
      }
      const projectRecord = project as unknown as Record<string, unknown>;
      const cutlistRecord = (projectRecord.cutlist ?? null) as Record<string, unknown> | null;
      const directRowsRaw = Array.isArray(cutlistRecord?.rows) ? (cutlistRecord?.rows as unknown[]) : [];
      if (directRowsRaw.length) {
        const mapped = directRowsRaw.map((row, idx) => {
          const item = (row ?? {}) as Record<string, unknown>;
          const clLong = String(item.clLong ?? item.clashLong ?? item.clash_left ?? "").trim();
          const clShort = String(item.clShort ?? item.clashShort ?? item.clash_right ?? "").trim();
          const clashing = String(item.Clashing ?? item.clashing ?? "").trim() || [clLong, clShort].filter(Boolean).join(" ");
          const split = splitClashing(clashing);
          const grainParsed = parseCutlistGrainFields(item.Grain ?? item.grain, item.grain);
          const includeInNestingRaw = item.includeInNesting ?? item.IncludeInNesting;
          const includeInNesting =
            includeInNestingRaw === false ||
            String(includeInNestingRaw ?? "").trim().toLowerCase() === "false"
              ? false
              : true;
          return {
            id: String(item.__cutlist_key ?? item.__id ?? `row_${idx + 1}`),
            room: String(item.Room ?? item.room ?? "Project Cutlist"),
            partType: String(item.partType ?? item["Part Type"] ?? item.Part ?? item.part ?? ""),
            board: String(item.Board ?? item.board ?? ""),
            name: String(item.Name ?? item.name ?? item.partName ?? ""),
            height: normalizeCutlistDimensionValue(item.Height ?? item.height),
            width: normalizeCutlistDimensionValue(item.Width ?? item.width),
            depth: normalizeCutlistDimensionValue(item.Depth ?? item.depth),
            quantity: String(item.Quantity ?? item.quantity ?? item.qty ?? 1),
            clashing,
            clashLeft: String(item.clashLeft ?? split.left ?? ""),
            clashRight: String(item.clashRight ?? split.right ?? ""),
            fixedShelf: String(item.fixedShelf ?? item["Fixed Shelf"] ?? ""),
            adjustableShelf: String(item.adjustableShelf ?? item["Adjustable Shelf"] ?? ""),
            fixedShelfDrilling: normalizeDrillingValue(item.fixedShelfDrilling ?? item["Fixed Shelf Drilling"]),
            adjustableShelfDrilling: normalizeDrillingValue(item.adjustableShelfDrilling ?? item["Adjustable Shelf Drilling"]),
            information: String(item.Information ?? item.information ?? item.info ?? ""),
            grain: grainParsed.grain,
            grainValue: grainParsed.grainValue,
            includeInNesting,
          };
        });
        setCutlistRows(mapped);
        setNestingVisibilityMap(
          Object.fromEntries(mapped.map((row) => [row.id, row.includeInNesting !== false])),
        );
        setProductionCutlist(null);
        return;
      }
      const storedCompanyId =
        typeof window !== "undefined"
          ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
          : "";
      const preferredCompanyIds = [storedCompanyId, String(project.companyId || "").trim(), String(user?.companyId || "").trim()].filter(Boolean);
      const all = await fetchCutlists(project.id, user?.uid, preferredCompanyIds);
      const production = all.find((item) => item.type === "production") ?? all[0] ?? null;
      setProductionCutlist(production);
      const mapped = (production?.parts ?? []).map((part, idx) => {
        const legacy = part as unknown as Record<string, unknown>;
        const grainParsed = parseCutlistGrainFields(
          legacy.Grain ?? legacy.grain ?? part.grain,
          legacy.grain ?? part.grain,
        );
        return {
          id: String(part.id ?? `row_${idx + 1}`),
          room: String(part.room ?? legacy.Room ?? "Project Cutlist"),
          partType: String(part.partType ?? legacy["Part Type"] ?? ""),
          board: String(part.material ?? legacy.Board ?? ""),
          name: String(part.label ?? legacy.Name ?? ""),
          height: normalizeCutlistDimensionValue(part.length ?? legacy.Height),
          width: normalizeCutlistDimensionValue(part.width ?? legacy.Width),
          depth: normalizeCutlistDimensionValue(part.depth ?? legacy.Depth),
          quantity: String(part.qty ?? legacy.Quantity ?? 1),
          clashing: String(part.clashing ?? legacy.Clashing ?? ""),
          clashLeft: splitClashing(String(part.clashing ?? legacy.Clashing ?? "")).left,
          clashRight: splitClashing(String(part.clashing ?? legacy.Clashing ?? "")).right,
          fixedShelf: String(legacy.fixedShelf ?? legacy["Fixed Shelf"] ?? ""),
          adjustableShelf: String(legacy.adjustableShelf ?? legacy["Adjustable Shelf"] ?? ""),
          fixedShelfDrilling: normalizeDrillingValue(legacy.fixedShelfDrilling ?? legacy["Fixed Shelf Drilling"]),
          adjustableShelfDrilling: normalizeDrillingValue(legacy.adjustableShelfDrilling ?? legacy["Adjustable Shelf Drilling"]),
          information: String(part.information ?? legacy.Information ?? ""),
          grain: grainParsed.grain,
          grainValue: grainParsed.grainValue,
          includeInNesting: true,
        };
      });
      setCutlistRows(mapped);
      setNestingVisibilityMap(
        Object.fromEntries(mapped.map((row) => [row.id, row.includeInNesting !== false])),
      );
    };
    void loadCutlist();
  }, [project, user?.uid]);

  useEffect(() => {
    if (!cutlistUiStateStorageKey) {
      setCutlistUiStateReady(false);
      return;
    }
    try {
      const raw = window.localStorage.getItem(cutlistUiStateStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          cutlistRoomFilter?: string;
          cutlistPartTypeFilter?: string;
          cutlistSearch?: string;
          initialCutlistRoomFilter?: string;
          initialCutlistPartTypeFilter?: string;
          initialCutlistSearch?: string;
          initialCutlistEntryRoom?: string;
          initialActiveCutlistPartType?: string;
          initialCutlistEntry?: Partial<Omit<CutlistRow, "id" | "room">>;
          initialCutlistDraftRows?: Array<Partial<CutlistDraftRow>>;
          nestingSearch?: string;
          nestingVisibilityMap?: Record<string, boolean>;
          nestingCollapsedGroups?: Record<string, boolean>;
          collapsedCutlistGroups?: Record<string, boolean>;
          expandedCabinetryRows?: Record<string, boolean>;
          expandedDrawerRows?: Record<string, boolean>;
          cutlistActivityFeed?: CutlistActivityEntry[];
        };
        if (typeof parsed.cutlistRoomFilter === "string" && parsed.cutlistRoomFilter.trim()) {
          setCutlistRoomFilter(parsed.cutlistRoomFilter);
        }
        if (typeof parsed.cutlistPartTypeFilter === "string" && parsed.cutlistPartTypeFilter.trim()) {
          setCutlistPartTypeFilter(parsed.cutlistPartTypeFilter);
        }
        if (typeof parsed.cutlistSearch === "string") {
          setCutlistSearch(parsed.cutlistSearch);
        }
        if (typeof parsed.initialCutlistRoomFilter === "string" && parsed.initialCutlistRoomFilter.trim()) {
          setInitialCutlistRoomFilter(parsed.initialCutlistRoomFilter);
        }
        if (typeof parsed.initialCutlistPartTypeFilter === "string" && parsed.initialCutlistPartTypeFilter.trim()) {
          setInitialCutlistPartTypeFilter(parsed.initialCutlistPartTypeFilter);
        }
        if (typeof parsed.initialCutlistSearch === "string") {
          setInitialCutlistSearch(parsed.initialCutlistSearch);
        }
        if (typeof parsed.initialCutlistEntryRoom === "string" && parsed.initialCutlistEntryRoom.trim()) {
          setInitialCutlistEntryRoom(parsed.initialCutlistEntryRoom);
        }
        if (typeof parsed.initialActiveCutlistPartType === "string") {
          setInitialActiveCutlistPartType(parsed.initialActiveCutlistPartType);
        }
        if (parsed.initialCutlistEntry && typeof parsed.initialCutlistEntry === "object") {
          const savedEntry = parsed.initialCutlistEntry;
          setInitialCutlistEntry({
            ...createEmptyCutlistEntry(),
            partType: String(savedEntry.partType ?? ""),
            board: String(savedEntry.board ?? ""),
            name: String(savedEntry.name ?? ""),
            height: String(savedEntry.height ?? ""),
            width: String(savedEntry.width ?? ""),
            depth: String(savedEntry.depth ?? ""),
            quantity: String(savedEntry.quantity ?? "1"),
            clashing: String(savedEntry.clashing ?? ""),
            clashLeft: String(savedEntry.clashLeft ?? ""),
            clashRight: String(savedEntry.clashRight ?? ""),
            fixedShelf: String(savedEntry.fixedShelf ?? ""),
            adjustableShelf: String(savedEntry.adjustableShelf ?? ""),
            fixedShelfDrilling: normalizeDrillingValue(savedEntry.fixedShelfDrilling),
            adjustableShelfDrilling: normalizeDrillingValue(savedEntry.adjustableShelfDrilling),
            information: String(savedEntry.information ?? ""),
            grain: Boolean(savedEntry.grain ?? false),
            grainValue: String(savedEntry.grainValue ?? ""),
          });
        }
        if (Array.isArray(parsed.initialCutlistDraftRows)) {
          const restoredDrafts = parsed.initialCutlistDraftRows
            .filter((row) => row && typeof row === "object")
            .map((row, idx) => {
              const item = row as Partial<CutlistDraftRow>;
              const partType = String(item.partType ?? "").trim();
              const room = String(item.room ?? "Project Cutlist").trim() || "Project Cutlist";
              const restored = createDraftCutlistRow(partType, room, item);
              return {
                ...restored,
                id: String(item.id ?? `draft_restored_${idx + 1}`),
                room,
                partType,
              };
            });
          setInitialCutlistDraftRows(restoredDrafts);
          setInitialCutlistDraftInitialized(true);
        }
        if (typeof parsed.nestingSearch === "string") {
          setNestingSearch(parsed.nestingSearch);
        }
        if (parsed.nestingVisibilityMap && typeof parsed.nestingVisibilityMap === "object") {
          setNestingVisibilityMap(parsed.nestingVisibilityMap);
        }
        if (parsed.nestingCollapsedGroups && typeof parsed.nestingCollapsedGroups === "object") {
          setNestingCollapsedGroups(parsed.nestingCollapsedGroups);
        }
        if (parsed.collapsedCutlistGroups && typeof parsed.collapsedCutlistGroups === "object") {
          setCollapsedCutlistGroups(parsed.collapsedCutlistGroups);
        }
        if (parsed.expandedCabinetryRows && typeof parsed.expandedCabinetryRows === "object") {
          setExpandedCabinetryRows(parsed.expandedCabinetryRows);
        }
        if (parsed.expandedDrawerRows && typeof parsed.expandedDrawerRows === "object") {
          setExpandedDrawerRows(parsed.expandedDrawerRows);
        }
      }
    } catch {
      // Ignore invalid local state and continue with defaults.
    } finally {
      setCutlistUiStateReady(true);
    }
  }, [cutlistUiStateStorageKey]);

  useEffect(() => {
    if (!cutlistUiStateStorageKey || !cutlistUiStateReady) return;
    const payload = {
      cutlistRoomFilter,
      cutlistPartTypeFilter,
      cutlistSearch,
      initialCutlistRoomFilter,
      initialCutlistPartTypeFilter,
      initialCutlistSearch,
      initialCutlistEntryRoom,
      initialActiveCutlistPartType,
      initialCutlistEntry,
      initialCutlistDraftRows,
      nestingSearch,
      nestingVisibilityMap,
      nestingCollapsedGroups,
      collapsedCutlistGroups,
      expandedCabinetryRows,
      expandedDrawerRows,
    };
    try {
      window.localStorage.setItem(cutlistUiStateStorageKey, JSON.stringify(payload));
    } catch {
      // Ignore storage failures in private/incognito/browser-restricted modes.
    }
  }, [
    cutlistUiStateStorageKey,
    cutlistUiStateReady,
    cutlistRoomFilter,
    cutlistPartTypeFilter,
    cutlistSearch,
    initialCutlistRoomFilter,
    initialCutlistPartTypeFilter,
    initialCutlistSearch,
    initialCutlistEntryRoom,
    initialActiveCutlistPartType,
    initialCutlistEntry,
    initialCutlistDraftRows,
    nestingSearch,
    nestingVisibilityMap,
    nestingCollapsedGroups,
    collapsedCutlistGroups,
    expandedCabinetryRows,
    expandedDrawerRows,
  ]);

  useEffect(() => {
    if (!project) {
      cutlistActivityProjectHydratedRef.current = false;
      lastPersistedCutlistActivityJsonRef.current = "";
      setCutlistActivityFeed([]);
      setCutlistActivityEnteringIds({});
      cutlistActivityNextIdRef.current = 1;
      return;
    }
    const restored = projectCutlistActivityFeed.slice(-120);
    const serialized = JSON.stringify(serializeCutlistActivityFeedForProject(restored));
    lastPersistedCutlistActivityJsonRef.current = serialized;
    cutlistActivityProjectHydratedRef.current = true;
    setCutlistActivityFeed(restored);
    setCutlistActivityEnteringIds({});
    const maxId = restored.reduce((m, e) => Math.max(m, Number(e.id || 0)), 0);
    cutlistActivityNextIdRef.current = Math.max(maxId + 1, Date.now());
  }, [project, projectCutlistActivityFeed]);

  useEffect(() => {
    if (!project || !cutlistActivityProjectHydratedRef.current) return;
    const nextSerialized = JSON.stringify(serializeCutlistActivityFeedForProject(cutlistActivityFeed));
    if (nextSerialized === lastPersistedCutlistActivityJsonRef.current) return;
    if (cutlistActivityPersistTimeoutRef.current != null) {
      window.clearTimeout(cutlistActivityPersistTimeoutRef.current);
    }
    cutlistActivityPersistTimeoutRef.current = window.setTimeout(() => {
      cutlistActivityPersistTimeoutRef.current = null;
      const nextFeeds = serializeCutlistActivityFeedForProject(cutlistActivityFeed);
      const nextSerializedInner = JSON.stringify(nextFeeds);
      if (nextSerializedInner === lastPersistedCutlistActivityJsonRef.current) return;
      const nextProjectSettings = {
        ...((project.projectSettings ?? {}) as Record<string, unknown>),
        cutlistActivityFeeds: nextFeeds,
      };
      void (async () => {
        const ok = await updateProjectPatch(project, {
          projectSettings: nextProjectSettings,
          projectSettingsJson: JSON.stringify(nextProjectSettings),
        });
        if (!ok) return;
        lastPersistedCutlistActivityJsonRef.current = nextSerializedInner;
        setProject((prev) =>
          prev
            ? {
                ...prev,
                projectSettings: nextProjectSettings,
              }
            : prev,
        );
      })();
    }, 300);
    return () => {
      if (cutlistActivityPersistTimeoutRef.current != null) {
        window.clearTimeout(cutlistActivityPersistTimeoutRef.current);
        cutlistActivityPersistTimeoutRef.current = null;
      }
    };
  }, [project, cutlistActivityFeed]);

  useEffect(() => {
    setNestingVisibilityMap((prev) => {
      const next: Record<string, boolean> = {};
      for (const row of cutlistRows) {
        const rowDefault = row.includeInNesting !== false;
        next[row.id] = typeof prev[row.id] === "boolean" ? prev[row.id] : rowDefault;
      }
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === next[k])) {
        return prev;
      }
      return next;
    });
  }, [cutlistRows]);

  useEffect(() => {
    const filters = cutlistRoomTabs.map((tab) => tab.filter);
    if (!filters.includes(cutlistRoomFilter)) {
      setCutlistRoomFilter(defaultCutlistRoom);
    }
    if (!cutlistEntryRoomOptions.includes(cutlistEntryRoom)) {
      const fallback = defaultCutlistRoom;
      setCutlistEntryRoom(fallback);
    }
  }, [cutlistEntryRoom, cutlistRoomFilter, cutlistRoomTabs, cutlistEntryRoomOptions, defaultCutlistRoom]);

  useEffect(() => {
    if (!cutlistRoomFilter || cutlistRoomFilter === "Project Cutlist") {
      return;
    }
    setCutlistEntryRoom(cutlistRoomFilter);
    setCutlistDraftRows((prev) =>
      prev.map((row) => ({
        ...row,
        room: cutlistRoomFilter,
      })),
    );
  }, [cutlistRoomFilter]);
  useEffect(() => {
    const filters = initialCutlistRoomTabs.map((tab) => tab.filter);
    const onlyProjectCutlistAvailable = filters.length === 1 && filters[0] === "Project Cutlist";
    if (isLoading && onlyProjectCutlistAvailable && initialCutlistRoomFilter && initialCutlistRoomFilter !== "Project Cutlist") {
      return;
    }
    if (!filters.includes(initialCutlistRoomFilter)) {
      setInitialCutlistRoomFilter(defaultInitialCutlistRoom);
    }
    if (!initialCutlistEntryRoomOptions.includes(initialCutlistEntryRoom)) {
      const fallback = defaultInitialCutlistRoom;
      setInitialCutlistEntryRoom(fallback);
    }
  }, [
    defaultInitialCutlistRoom,
    isLoading,
    initialCutlistEntryRoom,
    initialCutlistEntryRoomOptions,
    initialCutlistRoomFilter,
    initialCutlistRoomTabs,
  ]);
  useEffect(() => {
    if (!initialCutlistRoomFilter || initialCutlistRoomFilter === "Project Cutlist") {
      return;
    }
    setInitialCutlistEntryRoom(initialCutlistRoomFilter);
    setInitialCutlistDraftRows((prev) =>
      prev.map((row) => ({
        ...row,
        room: initialCutlistRoomFilter,
      })),
    );
  }, [initialCutlistRoomFilter]);

  useEffect(() => {
    const firstType = partTypeOptions[0] ?? "Part";
    if (!activeCutlistPartType) {
      setActiveCutlistPartType(firstType);
    }
    if (!cutlistDraftInitialized) {
      setCutlistDraftRows((prev) => {
        if (prev.length) return prev;
        return [createDraftCutlistRow(firstType, defaultCutlistRoom, { board: cutlistBoardOptions[0] ?? "" })];
      });
      setCutlistDraftInitialized(true);
    }
  }, [activeCutlistPartType, partTypeOptions, defaultCutlistRoom, cutlistBoardOptions, cutlistDraftInitialized]);
  useEffect(() => {
    if (!initialMeasurePartTypeOptions.length) {
      setInitialCutlistEntry((prev) => ({ ...prev, partType: "" }));
      return;
    }
    const current = String(initialCutlistEntry.partType || "").trim().toLowerCase();
    if (initialMeasurePartTypeOptions.some((name) => name.toLowerCase() === current)) {
      return;
    }
    setInitialCutlistEntry((prev) => ({ ...prev, partType: initialMeasurePartTypeOptions[0] ?? "" }));
  }, [initialCutlistEntry.partType, initialMeasurePartTypeOptions]);
  useEffect(() => {
    const firstType = initialMeasurePartTypeOptions[0] ?? "Part";
    if (!initialActiveCutlistPartType) {
      setInitialActiveCutlistPartType(firstType);
    }
    if (!initialCutlistDraftInitialized) {
      setInitialCutlistDraftInitialized(true);
    }
  }, [
    initialActiveCutlistPartType,
    initialCutlistDraftInitialized,
    initialMeasurePartTypeOptions,
  ]);

  const projectStatusRows = useMemo(
    () => normalizeProjectStatuses((companyDoc as Record<string, unknown> | null)?.projectStatuses),
    [companyDoc],
  );

  const projectStatusColorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of projectStatusRows) {
      map.set(String(row.name || "").trim().toLowerCase(), String(row.color || "").trim() || "#64748B");
    }
    return map;
  }, [projectStatusRows]);

  const statusOptions = useMemo(() => {
    const options = projectStatusRows.map((row) => row.name).filter(Boolean);
    const withDefaults = options.length ? options : statusDefaults;
    if (project?.statusLabel && !withDefaults.some((opt) => opt.toLowerCase() === String(project.statusLabel || "").toLowerCase())) {
      return [...withDefaults, project.statusLabel];
    }
    return withDefaults;
  }, [projectStatusRows, project?.statusLabel]);

  const projectStatusPillStyle = (statusLabel: string) => {
    const configured = projectStatusColorByName.get(String(statusLabel || "").trim().toLowerCase());
    if (configured) {
      return { backgroundColor: configured, color: "#FFFFFF" };
    }
    return fallbackStatusPillColors(statusLabel);
  };

  const onChangeStatus = async (value: string) => {
    if (!project || !value) {
      return;
    }

    setIsSavingStatus(true);
    const ok = await updateProjectStatus(project, value);
    if (ok) {
      setProject({ ...project, statusLabel: value });
      setProjectStatusMenuPos(null);
    }
    setIsSavingStatus(false);
  };

  const saveGeneralDetailsPatch = async (patch: Partial<Project>) => {
    if (!project || !generalAccess.edit) return false;
    setIsSavingGeneralDetails(true);
    const ok = await updateProjectPatch(project, patch as Record<string, unknown>);
    if (ok) {
      setProject((prev) => (prev ? { ...prev, ...patch } : prev));
      setLockMessage("");
    } else {
      setLockMessage("Could not save project details.");
    }
    setIsSavingGeneralDetails(false);
    return ok;
  };

  const onChangeAssignedProjectUser = async (uidValue: string) => {
    if (!project || !settingsAccess.edit) return;
    const nextUid = String(uidValue || "").trim();
    const nextMember =
      companyMembers.find((member) => String(member.uid || "").trim() === nextUid) ?? null;
    const patch: Partial<Project> = {
      assignedToUid: nextUid || "",
      assignedToName: nextMember?.displayName || "",
      assignedTo: nextMember?.displayName || "",
    };
    await saveGeneralDetailsPatch(patch);
  };

  const onChangeProjectCreatorUser = async (uidValue: string) => {
    if (!project || !isCurrentProjectCreator) return;
    const nextUid = String(uidValue || "").trim();
    const nextMember =
      companyMembers.find((member) => String(member.uid || "").trim() === nextUid) ?? null;
    if (!nextUid || !nextMember) return;
    if (
      nextUid === String(project.createdByUid ?? "").trim() &&
      nextMember.displayName === String(project.createdByName ?? "").trim()
    ) {
      return;
    }
    const patch: Partial<Project> = {
      createdByUid: nextUid,
      createdByName: nextMember.displayName,
    };
    await saveGeneralDetailsPatch(patch);
  };

  const commitClientDetails = async () => {
    if (!project || !generalAccess.edit) return;
    const patch: Partial<Project> = {};
    const nextCustomer = String(generalDetailsDraft.customer ?? "").trim();
    const nextPhone = String(generalDetailsDraft.clientPhone ?? "").trim();
    const nextEmail = String(generalDetailsDraft.clientEmail ?? "").trim();
    const nextAddress = String(generalDetailsDraft.clientAddress ?? "").trim();
    if (nextCustomer !== String(project.customer ?? "").trim()) patch.customer = nextCustomer;
    if (nextPhone !== String(project.clientPhone ?? "").trim()) patch.clientPhone = nextPhone;
    if (nextEmail !== String(project.clientEmail ?? "").trim()) patch.clientEmail = nextEmail;
    if (nextAddress !== String(project.clientAddress ?? "").trim()) patch.clientAddress = nextAddress;
    if (Object.keys(patch).length > 0) {
      await saveGeneralDetailsPatch(patch);
    }
  };

  const commitNotesDetails = async () => {
    if (!project || !generalAccess.edit) return;
    const nextNotes = String((isEditingNotes && notesEditorRef.current
      ? notesEditorRef.current.innerHTML
      : generalDetailsDraft.notes) ?? "");
    if (nextNotes !== String(project.notes ?? "")) {
      await saveGeneralDetailsPatch({ notes: nextNotes });
    }
  };

  const applyNotesFormat = (command: string) => {
    if (!isEditingNotes || !generalAccess.edit) return;
    const editor = notesEditorRef.current;
    if (!editor) return;
    editor.focus();
    try {
      document.execCommand(command, false);
    } catch {
      // no-op
    }
    setGeneralDetailsDraft((prev) => ({ ...prev, notes: editor.innerHTML }));
  };

  const NOTES_BULLET_PREFIX = "\u2022\u00A0";

  const insertNotesBullet = () => {
    if (!isEditingNotes || !generalAccess.edit) return;
    const editor = notesEditorRef.current;
    if (!editor) return;
    try {
      let sel = window.getSelection();
      let range: Range | null = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;

      if (!range || !editor.contains(range.commonAncestorContainer)) {
        editor.focus();
        sel = window.getSelection();
        range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      }

      if (sel && range && editor.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const textNode = document.createTextNode(NOTES_BULLET_PREFIX);
        range.insertNode(textNode);

        const caretRange = document.createRange();
        caretRange.setStartAfter(textNode);
        caretRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(caretRange);
      } else {
        editor.focus();
        document.execCommand("insertText", false, NOTES_BULLET_PREFIX);
      }
    } catch {
      // no-op
    }
    setGeneralDetailsDraft((prev) => ({ ...prev, notes: editor.innerHTML }));
  };

  const currentNotesBlock = () => {
    const editor = notesEditorRef.current;
    if (!editor) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const anchor = sel.anchorNode;
    const base =
      anchor && anchor.nodeType === Node.TEXT_NODE
        ? (anchor.parentElement as Element | null)
        : (anchor as Element | null);
    const block = base?.closest("div, p");
    if (!block || !editor.contains(block)) return null;
    return block as HTMLElement;
  };

  const ensureBulletPrefixOnCurrentLine = () => {
    const block = currentNotesBlock();
    if (!block) return;
    const txt = String(block.textContent ?? "").replace(/\u00A0/g, " ").trimStart();
    if (!txt.startsWith("\u2022")) {
      block.textContent = `${NOTES_BULLET_PREFIX}${txt}`;
    } else if (!txt.startsWith(NOTES_BULLET_PREFIX)) {
      block.textContent = txt.replace(/^\u2022(?:\u00A0|\s)*/, NOTES_BULLET_PREFIX);
    }
  };

  const removeBulletPrefixFromCurrentLine = () => {
    const block = currentNotesBlock();
    if (!block) return;
    const txt = String(block.textContent ?? "");
    block.textContent = txt.replace(/^\s*\u2022(?:\u00A0|\s)?/, "");
  };

  const isCurrentBulletLineEmpty = (): boolean => {
    const block = currentNotesBlock();
    if (!block) return false;
    const txt = String(block.textContent ?? "").replace(/\u00A0/g, " ");
    const noBullet = txt.replace(/^\s*\u2022(?:\u00A0|\s)?/, "").trim();
    return noBullet.length === 0;
  };

  const isCurrentLineBullet = (): boolean => {
    const block = currentNotesBlock();
    if (!block) return false;
    const txt = String(block.textContent ?? "").replace(/\u00A0/g, " ").trimStart();
    return txt.startsWith("\u2022");
  };

  const toggleNotesBulletMode = () => {
    if (!isEditingNotes || !generalAccess.edit) return;
    const editor = notesEditorRef.current;
    if (!editor) return;
    editor.focus();
    setNotesBulletMode((prev) => {
      const next = !prev;
      if (next) {
        ensureBulletPrefixOnCurrentLine();
      }
      return next;
    });
  };

  const insertNextBulletLine = () => {
    const editor = notesEditorRef.current;
    if (!editor) return;
    const block = currentNotesBlock();

    const newBlock = document.createElement("div");
    const textNode = document.createTextNode(NOTES_BULLET_PREFIX);
    newBlock.appendChild(textNode);
    if ((block as HTMLElement | null)?.classList?.contains("notes-paragraph-line") || notesParagraphMode) {
      newBlock.classList.add("notes-paragraph-line");
    }

    if (block && editor.contains(block)) {
      if (block.nextSibling) {
        block.parentNode?.insertBefore(newBlock, block.nextSibling);
      } else {
        block.parentNode?.appendChild(newBlock);
      }
    } else {
      editor.appendChild(newBlock);
    }

    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(textNode, textNode.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const applyParagraphClassToCurrentLine = () => {
    const editor = notesEditorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode;
    if (!anchor) return;
    const base = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element);
    if (!base) return;
    const block = base.closest("div, p");
    if (!block || !editor.contains(block)) return;
    block.classList.add("notes-paragraph-line");
  };

  const toggleNotesParagraphMode = () => {
    if (!isEditingNotes || !generalAccess.edit) return;
    const editor = notesEditorRef.current;
    if (!editor) return;
    editor.focus();
    setNotesParagraphMode((prev) => {
      const next = !prev;
      if (next) {
        applyParagraphClassToCurrentLine();
      }
      return next;
    });
  };

  const refreshNotesToolbarState = () => {
    if (!isEditingNotes) return;
    const editor = notesEditorRef.current;
    const sel = window.getSelection();
    const insideEditor =
      !!editor &&
      !!sel &&
      sel.rangeCount > 0 &&
      editor.contains(sel.anchorNode);
    if (!insideEditor) return;
    setNotesBulletMode(isCurrentLineBullet());
    try {
      setNotesBoldActive(!!document.queryCommandState("bold"));
      setNotesItalicActive(!!document.queryCommandState("italic"));
      setNotesStrikeActive(!!document.queryCommandState("strikeThrough"));
    } catch {
      setNotesBoldActive(false);
      setNotesItalicActive(false);
      setNotesStrikeActive(false);
    }
  };
  const exitParagraphModeOnCurrentLine = () => {
    const editor = notesEditorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode;
    const base =
      anchor && anchor.nodeType === Node.TEXT_NODE
        ? (anchor.parentElement as Element | null)
        : (anchor as Element | null);
    const currentBlock = base?.closest("div, p");
    if (currentBlock && editor.contains(currentBlock)) {
      currentBlock.classList.remove("notes-paragraph-line");
    }
  };

  const isCurrentParagraphLineEmpty = (): boolean => {
    const editor = notesEditorRef.current;
    if (!editor) return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const anchor = sel.anchorNode;
    const base =
      anchor && anchor.nodeType === Node.TEXT_NODE
        ? (anchor.parentElement as Element | null)
        : (anchor as Element | null);
    const currentBlock = base?.closest("div, p");
    if (!currentBlock || !editor.contains(currentBlock)) return false;
    if (!currentBlock.classList.contains("notes-paragraph-line")) return false;
    const text = String(currentBlock.textContent ?? "").replace(/\u00A0/g, " ").trim();
    return text.length === 0;
  };

  useEffect(() => {
    if (!isEditingNotes) return;
    const editor = notesEditorRef.current;
    if (!editor) return;
    editor.innerHTML = notesToDisplayHtml(generalDetailsDraft.notes);
  }, [isEditingNotes]);

  useEffect(() => {
    if (isEditingNotes) return;
    setNotesParagraphMode(false);
    setNotesBulletMode(false);
    setNotesBoldActive(false);
    setNotesItalicActive(false);
    setNotesStrikeActive(false);
    notesLastEnterAtRef.current = 0;
  }, [isEditingNotes]);

  useEffect(() => {
    if (!isEditingNotes) return;
    const onSelectionChange = () => refreshNotesToolbarState();
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [isEditingNotes]);

  useEffect(() => {
    if (!isEditingClientDetails && !isEditingNotes) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (isEditingClientDetails) {
        const root = clientDetailsContainerRef.current;
        if (root && !root.contains(target)) {
          setIsEditingClientDetails(false);
          void commitClientDetails();
        }
      }

      if (isEditingNotes) {
        const root = notesContainerRef.current;
        if (root && !root.contains(target)) {
          setIsEditingNotes(false);
          void commitNotesDetails();
        }
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [isEditingClientDetails, isEditingNotes, commitClientDetails, commitNotesDetails]);

  useEffect(() => {
    if (!projectStatusMenuPos) return;

    const closeMenu = () => setProjectStatusMenuPos(null);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-status-menu='true']")) return;
      if (target.closest("[data-status-trigger='true']")) return;
      closeMenu();
    };

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [projectStatusMenuPos]);

  const saveTags = async (nextTags: string[]) => {
    if (!project) {
      return;
    }
    setIsSavingTags(true);
    const ok = await updateProjectTags(project, nextTags, projectTags);
    if (ok) {
      setProjectTags(nextTags);
      setProject({ ...project, tags: nextTags });
      const resolvedCompanyId =
        String(project.companyId || "").trim() ||
        (typeof window !== "undefined"
          ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
          : "");
      if (resolvedCompanyId) {
        await resyncCompanyProjectTagUsage(resolvedCompanyId);
        const refreshed = await fetchCompanyDoc(resolvedCompanyId);
        if (refreshed) {
          setCompanyDoc(refreshed);
        }
      }
    }
    setIsSavingTags(false);
  };

  const onAddTagValue = async (rawTag: string) => {
    const typed = String(rawTag || "").trim();
    const next =
      companyTagSuggestions.find((row) => row.value.toLowerCase() === typed.toLowerCase())?.value ??
      typed;
    if (!next || !project || isSavingTags || projectTags.length >= 5 || !canEditTags) {
      return;
    }
    const exists = projectTags.some((tag) => tag.toLowerCase() === next.toLowerCase());
    if (exists) {
      setTagInput("");
      setShowTagSuggestions(false);
      setIsTagInputOpen(false);
      return;
    }
    const nextTags = [...projectTags, next].slice(0, 5);
    setTagInput("");
    setShowTagSuggestions(false);
    setIsTagInputOpen(false);
    await saveTags(nextTags);
  };

  const onAddTag = async () => {
    await onAddTagValue(tagInput);
  };

  const onDeleteTag = async (tagToDelete: string) => {
    if (!project || isSavingTags || !canEditTags) {
      return;
    }
    const nextTags = projectTags.filter((tag) => tag.toLowerCase() !== tagToDelete.toLowerCase());
    await saveTags(nextTags);
  };

  const onAddCutlistRoom = async () => {
    if (!project || isSavingSalesRooms || !salesAccess.edit) {
      return;
    }
    setAddRoomName("");
    setIsAddRoomModalOpen(true);
  };

  const onConfirmAddCutlistRoom = async () => {
    if (!project || isSavingSalesRooms || !salesAccess.edit) {
      return;
    }
    const existingLower = new Set(salesRoomRows.map((row) => String(row.name || "").trim().toLowerCase()));
    const next = String(addRoomName || "").trim();
    if (!next) {
      return;
    }
    if (existingLower.has(next.toLowerCase())) {
      setLockMessage("A room with that name already exists.");
      return;
    }
    setLockMessage("");
    const nextRooms = [...salesRoomRows, { name: next, included: true, totalPrice: "0.00" }];
    const nextSales = {
      ...salesPayload,
      rooms: nextRooms,
    } as Record<string, unknown>;
    const nextProjectSettings = {
      ...((project.projectSettings ?? {}) as Record<string, unknown>),
      sales: nextSales,
    };
    setIsSavingSalesRooms(true);
    const ok = await updateProjectPatch(project, {
      sales: nextSales,
      salesJson: JSON.stringify(nextSales),
      projectSettings: nextProjectSettings,
      projectSettingsJson: JSON.stringify(nextProjectSettings),
    });
    if (ok) {
      setProject((prev) =>
        prev
          ? {
              ...prev,
              projectSettings: {
                ...(prev.projectSettings ?? {}),
                sales: nextSales,
              },
            }
          : prev,
      );
    }
    setIsSavingSalesRooms(false);
    if (ok) {
      setIsAddRoomModalOpen(false);
      setAddRoomName("");
      setCutlistRoomFilter(next);
      setCutlistEntryRoom(next);
      setInitialCutlistRoomFilter(next);
      setInitialCutlistEntryRoom(next);
    }
  };

  const onToggleSalesRoomIncluded = async (roomName: string, included: boolean) => {
    if (!project || isSavingSalesRooms || !salesAccess.edit) return;
    const key = String(roomName || "").trim().toLowerCase();
    const nextRooms = salesRoomRows.map((row) =>
      String(row.name || "").trim().toLowerCase() === key ? { ...row, included } : row,
    );
    const nextSales = {
      ...salesPayload,
      rooms: nextRooms,
    } as Record<string, unknown>;
    const nextProjectSettings = {
      ...((project.projectSettings ?? {}) as Record<string, unknown>),
      sales: nextSales,
    };
    setIsSavingSalesRooms(true);
    const ok = await updateProjectPatch(project, {
      sales: nextSales,
      salesJson: JSON.stringify(nextSales),
      projectSettings: nextProjectSettings,
      projectSettingsJson: JSON.stringify(nextProjectSettings),
    });
    if (ok) {
      setProject((prevProject) =>
        prevProject
          ? {
              ...prevProject,
              projectSettings: {
                ...(prevProject.projectSettings ?? {}),
                sales: nextSales,
              },
            }
          : prevProject,
      );
    }
    setIsSavingSalesRooms(false);
  };

  const onToggleSalesProductSelected = async (productName: string, selected: boolean) => {
    if (!project || isSavingSalesRooms || !salesAccess.edit) return;
    const key = String(productName || "").trim().toLowerCase();
    const nextProducts = salesProductRows.map((row) =>
      String(row.name || "").trim().toLowerCase() === key ? { ...row, selected } : row,
    );
    const nextSales = {
      ...salesPayload,
      products: nextProducts,
    } as Record<string, unknown>;
    const nextProjectSettings = {
      ...((project.projectSettings ?? {}) as Record<string, unknown>),
      sales: nextSales,
    };
    setIsSavingSalesRooms(true);
    const ok = await updateProjectPatch(project, {
      sales: nextSales,
      salesJson: JSON.stringify(nextSales),
      projectSettings: nextProjectSettings,
      projectSettingsJson: JSON.stringify(nextProjectSettings),
    });
    if (ok) {
      setProject((prevProject) =>
        prevProject
          ? {
              ...prevProject,
              projectSettings: {
                ...(prevProject.projectSettings ?? {}),
                sales: nextSales,
              },
            }
          : prevProject,
      );
    }
    setIsSavingSalesRooms(false);
  };

  const onToggleSalesQuoteExtraIncluded = async (extra: SalesQuoteExtraRow, included: boolean) => {
    if (!project || isSavingSalesRooms || !salesAccess.edit) return;
    const targetIds = new Set([String(extra.id || "").trim(), String(extra.name || "").trim()].filter(Boolean));
    const nextIncluded = salesQuoteExtrasIncluded.filter((item) => !targetIds.has(String(item || "").trim()));
    if (included) nextIncluded.push(String(extra.id || extra.name || "").trim());
    const nextSales = {
      ...salesPayload,
      quoteExtrasIncluded: Array.from(new Set(nextIncluded.filter(Boolean))),
    } as Record<string, unknown>;
    const nextProjectSettings = {
      ...((project.projectSettings ?? {}) as Record<string, unknown>),
      sales: nextSales,
    };
    setIsSavingSalesRooms(true);
    const ok = await updateProjectPatch(project, {
      sales: nextSales,
      salesJson: JSON.stringify(nextSales),
      projectSettings: nextProjectSettings,
      projectSettingsJson: JSON.stringify(nextProjectSettings),
    });
    if (ok) {
      setProject((prevProject) =>
        prevProject
          ? {
              ...prevProject,
              projectSettings: {
                ...(prevProject.projectSettings ?? {}),
                sales: nextSales,
              },
            }
          : prevProject,
      );
    }
    setIsSavingSalesRooms(false);
  };

  const onRenameSalesRoom = async (oldName: string, rawNextName: string) => {
    if (!project || isSavingSalesRooms || !salesAccess.edit) return;
    const prev = String(oldName || "").trim();
    const next = String(rawNextName || "").trim();
    if (!prev) return;
    if (!next || next.toLowerCase() === prev.toLowerCase()) return;
    const exists = salesRoomRows.some(
      (row) => String(row.name || "").trim().toLowerCase() === next.toLowerCase() && String(row.name || "").trim().toLowerCase() !== prev.toLowerCase(),
    );
    if (exists) return;
    const nextRooms = salesRoomRows.map((row) =>
      String(row.name || "").trim().toLowerCase() === prev.toLowerCase() ? { ...row, name: next } : row,
    );
    const nextSales = {
      ...salesPayload,
      rooms: nextRooms,
    } as Record<string, unknown>;
    const nextProjectSettings = {
      ...((project.projectSettings ?? {}) as Record<string, unknown>),
      sales: nextSales,
    };
    setIsSavingSalesRooms(true);
    const ok = await updateProjectPatch(project, {
      sales: nextSales,
      salesJson: JSON.stringify(nextSales),
      projectSettings: nextProjectSettings,
      projectSettingsJson: JSON.stringify(nextProjectSettings),
    });
    if (ok) {
      setProject((prevProject) =>
        prevProject
          ? {
              ...prevProject,
              projectSettings: {
                ...(prevProject.projectSettings ?? {}),
                sales: nextSales,
              },
            }
          : prevProject,
      );
      if (cutlistRoomFilter === prev) setCutlistRoomFilter(next);
      if (cutlistEntryRoom === prev) setCutlistEntryRoom(next);
      if (initialCutlistRoomFilter === prev) setInitialCutlistRoomFilter(next);
      if (initialCutlistEntryRoom === prev) setInitialCutlistEntryRoom(next);
    }
    setIsSavingSalesRooms(false);
  };

  const startEditingSalesRoom = (roomName: string) => {
    setEditingSalesRoomName(roomName);
    setEditingSalesRoomDraftName(roomName);
  };

  const cancelEditingSalesRoom = () => {
    setEditingSalesRoomName("");
    setEditingSalesRoomDraftName("");
  };

  const commitEditingSalesRoom = async () => {
    const oldName = String(editingSalesRoomName || "").trim();
    const nextName = String(editingSalesRoomDraftName || "").trim();
    cancelEditingSalesRoom();
    if (!oldName) return;
    await onRenameSalesRoom(oldName, nextName);
  };

  const onDeleteSalesRoom = async (roomName: string) => {
    if (!project || isSavingSalesRooms || !salesAccess.edit) return;
    const normalized = String(roomName || "").trim();
    if (!normalized) return;
    const lower = normalized.toLowerCase();
      const room = displayedSalesRoomRows.find((row) => String(row.name || "").trim().toLowerCase() === lower);
    const parsedValue = Number.parseFloat(String(room?.totalPrice ?? "").replace(/[^0-9.-]/g, ""));
    const hasValue = Number.isFinite(parsedValue) ? Math.abs(parsedValue) > 0 : String(room?.totalPrice ?? "").trim().length > 0;
    if (hasValue) {
      setSalesRoomDeleteBlocked({ roomName: normalized });
      return;
    }

    const nextRooms = salesRoomRows.filter((row) => String(row.name || "").trim().toLowerCase() !== lower);
    const nextSales = {
      ...salesPayload,
      rooms: nextRooms,
    } as Record<string, unknown>;
    const nextProjectSettings = {
      ...((project.projectSettings ?? {}) as Record<string, unknown>),
      sales: nextSales,
    };

    setIsSavingSalesRooms(true);
    const ok = await updateProjectPatch(project, {
      sales: nextSales,
      salesJson: JSON.stringify(nextSales),
      projectSettings: nextProjectSettings,
      projectSettingsJson: JSON.stringify(nextProjectSettings),
    });
    if (ok) {
      setProject((prevProject) =>
        prevProject
          ? {
              ...prevProject,
              projectSettings: {
                ...(prevProject.projectSettings ?? {}),
                sales: nextSales,
              },
            }
          : prevProject,
      );
      if (cutlistRoomFilter.toLowerCase() === lower) setCutlistRoomFilter("Project Cutlist");
      if (cutlistEntryRoom.toLowerCase() === lower) setCutlistEntryRoom(defaultCutlistRoom);
      if (initialCutlistRoomFilter.toLowerCase() === lower) setInitialCutlistRoomFilter("Project Cutlist");
      if (initialCutlistEntryRoom.toLowerCase() === lower) setInitialCutlistEntryRoom(defaultInitialCutlistRoom);
    }
    setIsSavingSalesRooms(false);
  };

  const onDeleteProject = async () => {
    if (!project || isDeleting || !canDeleteProject) {
      return;
    }
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setIsDeleting(true);
    const ok = await softDeleteProject(project);
    if (ok) {
      router.push("/dashboard");
      return;
    }
    setDeleteArmed(false);
    setIsDeleting(false);
  };

  const onGrantProductionUnlock = async () => {
    if (!project || !canGrantProductionUnlock || isGrantingUnlock) {
      return;
    }
    const targetUid = String(unlockTargetUid || "").trim();
    if (!targetUid) {
      setLockMessage("Select a staff member to unlock production for.");
      return;
    }
    setIsGrantingUnlock(true);
    const expiryIso = await grantTempProductionAccess(project, targetUid, unlockHours);
    if (expiryIso) {
      const settings = (project.projectSettings ?? {}) as Record<string, unknown>;
      const map = ((settings.productionTempEdit ?? {}) as Record<string, unknown>);
      const nextProject = {
        ...project,
        projectSettings: {
          ...settings,
          productionTempEdit: {
            ...map,
            [targetUid]: expiryIso,
          },
        },
      };
      setProject(nextProject);
      setLockMessage("Production unlocked temporarily.");
    } else {
      setLockMessage("Could not unlock production right now.");
    }
    setIsGrantingUnlock(false);
  };

  const persistProductionForm = async (next: ProductionFormState) => {
    if (!project) return false;
    const currentSettings = (project.projectSettings ?? {}) as Record<string, unknown>;
    const boardTypes = next.boardTypes.map((row) => ({
      colour: row.colour,
      thickness: row.thickness,
      finish: row.finish,
      edging: row.edging || "Matching",
      grain: Boolean(row.grain),
      lacquer: Boolean(row.lacquer),
      sheetSize: row.sheetSize,
      sheets: row.sheets,
      edgetape: row.edgetape,
    }));
    const nextSettings: Record<string, unknown> = {
      ...currentSettings,
      carcassThickness: next.existing.carcassThickness,
      panelThickness: next.existing.panelThickness,
      frontsThickness: next.existing.frontsThickness,
      baseCabHeight: next.cabinetry.baseCabHeight,
      footDistanceBack: next.cabinetry.footDistanceBack,
      tallCabHeight: next.cabinetry.tallCabHeight,
      footHeight: next.cabinetry.footHeight,
      hobCentre: next.cabinetry.hobCentre,
      hobSide: next.cabinetry.hobSide,
      hardwareCategory: next.hardware.hardwareCategory,
      newDrawerType: next.hardware.newDrawerType,
      hingeType: next.hardware.hingeType,
      boardTypes,
    };

    const ok = await updateProjectPatch(project, {
      projectSettings: nextSettings,
      projectSettingsJson: JSON.stringify(nextSettings),
    });
    if (ok) {
      setProject({ ...project, projectSettings: nextSettings });
    }
    return ok;
  };

  const persistOrderMiscDraft = async (nextByCategory: Record<string, Record<string, OrderMiscDraftRow>>) => {
    if (!project) return false;
    const currentSettings = (project.projectSettings ?? {}) as Record<string, unknown>;
    const nextSettings: Record<string, unknown> = {
      ...currentSettings,
      orderMiscDraftByCategory: nextByCategory,
    };
    const ok = await updateProjectPatch(project, {
      projectSettings: nextSettings,
      projectSettingsJson: JSON.stringify(nextSettings),
    });
    if (ok) {
      setProject({ ...project, projectSettings: nextSettings });
    }
    return ok;
  };
  const persistOrderHingeDraft = async (nextByCategory: Record<string, OrderHingeRow[]>) => {
    if (!project) return false;
    const currentSettings = (project.projectSettings ?? {}) as Record<string, unknown>;
    const nextSettings: Record<string, unknown> = {
      ...currentSettings,
      orderHingeRowsByCategory: nextByCategory,
    };
    const ok = await updateProjectPatch(project, {
      projectSettings: nextSettings,
      projectSettingsJson: JSON.stringify(nextSettings),
    });
    if (ok) {
      setProject({ ...project, projectSettings: nextSettings });
    }
    return ok;
  };

  const boardColourCountsFromRows = (rows: ProductionBoardRow[]) => {
    const map = new Map<string, BoardColourMemoryRow>();
    for (const row of rows) {
      const value = String(row.colour || "").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      const hit = map.get(key);
      if (hit) {
        hit.count += 1;
        hit.value = value;
      } else {
        map.set(key, { value, count: 1 });
      }
    }
    return map;
  };

  const syncBoardColourMemoryDelta = async (prevRows: ProductionBoardRow[], nextRows: ProductionBoardRow[]) => {
    if (!project?.companyId) return;

    const previousCounts = boardColourCountsFromRows(prevRows);
    const nextCounts = boardColourCountsFromRows(nextRows);

    const fresh = (await fetchCompanyDoc(project.companyId)) ?? companyDoc ?? {};
    const raw = (fresh.boardMaterialUsage ?? {}) as unknown;
    const normalized = normalizeBoardColourMemory(raw);
    const usage = new Map<string, BoardColourMemoryRow>();
    for (const row of normalized) {
      usage.set(row.value.toLowerCase(), { ...row });
    }

    const keys = new Set<string>([...previousCounts.keys(), ...nextCounts.keys()]);
    for (const key of keys) {
      const prevCount = previousCounts.get(key)?.count ?? 0;
      const nowCount = nextCounts.get(key)?.count ?? 0;
      const delta = nowCount - prevCount;
      if (!delta) continue;

      const existing = usage.get(key);
      if (existing) {
        const nextTotal = existing.count + delta;
        if (nextTotal <= 0) {
          usage.delete(key);
        } else {
          existing.count = nextTotal;
          existing.value = nextCounts.get(key)?.value ?? existing.value;
        }
      } else if (delta > 0) {
        usage.set(key, { value: nextCounts.get(key)?.value ?? key, count: delta });
      }
    }

    const colours = Array.from(usage.values())
      .filter((row) => row.count > 0 && String(row.value || "").trim())
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    const nextUsage = raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>), colours }
      : { colours };

    const ok = await saveCompanyDocPatch(project.companyId, { boardMaterialUsage: nextUsage });
    if (ok) {
      setCompanyDoc((prev) => ({ ...(prev ?? {}), boardMaterialUsage: nextUsage }));
    }
  };

  const syncBoardColourMemorySingleChange = async (oldColourRaw: string, newColourRaw: string) => {
    if (!project?.companyId) return;
    const oldColour = String(oldColourRaw || "").trim();
    const newColour = String(newColourRaw || "").trim();
    if (!oldColour && !newColour) return;

    const fresh = (await fetchCompanyDoc(project.companyId)) ?? companyDoc ?? {};
    const raw = (fresh.boardMaterialUsage ?? {}) as unknown;
    const normalized = normalizeBoardColourMemory(raw);
    const usage = new Map<string, BoardColourMemoryRow>();
    for (const row of normalized) {
      usage.set(row.value.toLowerCase(), { ...row });
    }

    if (oldColour && oldColour.toLowerCase() !== newColour.toLowerCase()) {
      const oldKey = oldColour.toLowerCase();
      const oldHit = usage.get(oldKey);
      if (oldHit) {
        oldHit.count -= 1;
        if (oldHit.count <= 0) usage.delete(oldKey);
      }
    }

    if (newColour) {
      const newKey = newColour.toLowerCase();
      const newHit = usage.get(newKey);
      if (newHit) {
        newHit.count += 1;
        newHit.value = newColour;
      } else {
        usage.set(newKey, { value: newColour, count: 1 });
      }
    }

    const colours = Array.from(usage.values())
      .filter((row) => row.count > 0 && String(row.value || "").trim())
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    const nextUsage = raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>), colours }
      : { colours };

    const ok = await saveCompanyDocPatch(project.companyId, { boardMaterialUsage: nextUsage });
    if (ok) {
      setCompanyDoc((prev) => ({ ...(prev ?? {}), boardMaterialUsage: nextUsage }));
    }
  };

  const onChangeExisting = async (key: keyof ProductionFormState["existing"], value: string) => {
    const next = {
      ...productionForm,
      existing: { ...productionForm.existing, [key]: value },
    };
    setProductionForm(next);
    await persistProductionForm(next);
  };

  const onCabinetryDraftChange = (key: keyof ProductionFormState["cabinetry"], value: string) => {
    setProductionForm((prev) => ({
      ...prev,
      cabinetry: { ...prev.cabinetry, [key]: value },
    }));
  };

  const onCabinetryBlurSave = async () => {
    await persistProductionForm(productionForm);
  };

  const onHardwareCategoryChange = async (category: string) => {
    if (hasDrawerRowsInUse) return;
    const drawer = defaultDrawerForCategory(category);
    const next = {
      ...productionForm,
      hardware: {
        hardwareCategory: category,
        newDrawerType: drawer,
        hingeType: category,
      },
    };
    setProductionForm(next);
    await persistProductionForm(next);
  };

  const onChangeDrawerType = async (value: string) => {
    if (hasDrawerRowsInUse) return;
    const next = {
      ...productionForm,
      hardware: { ...productionForm.hardware, newDrawerType: value },
    };
    setProductionForm(next);
    await persistProductionForm(next);
  };

  const onAddBoardRow = async () => {
    const next = {
      ...productionForm,
      boardTypes: [...productionForm.boardTypes, newBoardRow()],
    };
    setProductionForm(next);
    await persistProductionForm(next);
  };

  const onRemoveBoardRow = async (id: string) => {
    const prevRows = productionForm.boardTypes;
    const nextRows = productionForm.boardTypes.filter((row) => row.id !== id);
    const next = {
      ...productionForm,
      boardTypes: nextRows,
    };
    setProductionForm(next);
    const ok = await persistProductionForm(next);
    if (ok) {
      await syncBoardColourMemoryDelta(prevRows, next.boardTypes);
    }
  };

  const onBoardFieldDraftChange = (id: string, patch: Partial<ProductionBoardRow>) => {
    setProductionForm((prev) => ({
      ...prev,
      boardTypes: prev.boardTypes.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  };

  const onBoardFieldCommit = async (id: string, patch: Partial<ProductionBoardRow>, bumpColour = false) => {
    const prevRows = productionForm.boardTypes;
    const next = {
      ...productionForm,
      boardTypes: productionForm.boardTypes.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    };
    setProductionForm(next);
    const ok = await persistProductionForm(next);
    if (ok && bumpColour) {
      const oldColour = String(prevRows.find((row) => row.id === id)?.colour ?? "").trim();
      const newColour = String(patch.colour ?? "").trim();
      if (newColour.toLowerCase() !== oldColour.toLowerCase()) {
        await syncBoardColourMemorySingleChange(oldColour, newColour);
      }
    }
  };

  const validateCutlistRowInput = (
    row: Partial<CutlistRow>,
    partType: string,
    rowLabel: string,
  ): CutlistValidationIssue[] => {
    const errors: CutlistValidationIssue[] = [];
    const isDrawer = isDrawerPartType(partType);
    if (!String(partType || "").trim()) errors.push({ field: "partType", message: `${rowLabel}: Part Type is required.` });

    const board = String(row.board || "").trim();
    const name = String(row.name || "").trim();
    const height = parsePositiveNumber(row.height);
    const width = parsePositiveNumber(row.width);
    const depth = parsePositiveNumber(row.depth);
    const quantity = parsePositiveNumber(row.quantity);
    const drawerTokens = parseDrawerHeightTokens(String(row.height ?? ""));

    if (!board) errors.push({ field: "board", message: `${rowLabel}: Board is required.` });
    if (!name) errors.push({ field: "name", message: `${rowLabel}: Part Name is required.` });

    if (!quantity) errors.push({ field: "quantity", message: `${rowLabel}: Quantity must be greater than 0.` });

    if (isDrawer || isCabinetryPartType(partType)) {
      if (!width) errors.push({ field: "width", message: `${rowLabel}: Width is required.` });
      if (!depth) errors.push({ field: "depth", message: `${rowLabel}: Depth is required.` });
      if (!height && !isDrawer) errors.push({ field: "height", message: `${rowLabel}: Height is required.` });
    }

    if (isDrawer) {
      if (!width) errors.push({ field: "width", message: `${rowLabel}: Width is required for drawer parts.` });
      if (!depth) errors.push({ field: "depth", message: `${rowLabel}: Depth is required for drawer parts.` });
      if (!drawerTokens.length) errors.push({ field: "height", message: `${rowLabel}: Height selection is required for drawer parts.` });
      const compareDepth = depth == null
        ? null
        : Math.max(0, Number(depth) - Number(selectedDrawerBreakdown.spaceRequirement ?? 0));
      const hasValidHardwareDepth =
        compareDepth != null &&
        (
          !selectedDrawerBreakdown.hardwareLengths.length ||
          selectedDrawerBreakdown.hardwareLengths.some((opt) => Number(opt) <= compareDepth)
        );
      if (compareDepth != null && !hasValidHardwareDepth) {
        errors.push({ field: "depth", message: `${rowLabel}: Depth is too small for selected drawer hardware.` });
      }
    }

    const filledDims = [height, width, depth].filter((v) => v != null).length;
    if (!isDrawer && !isCabinetryPartType(partType) && filledDims < 2) {
      if (height == null) errors.push({ field: "height", message: `${rowLabel}: Fill at least 2 dimensions (Height/Width/Depth).` });
      if (width == null) errors.push({ field: "width", message: `${rowLabel}: Fill at least 2 dimensions (Height/Width/Depth).` });
      if (depth == null) errors.push({ field: "depth", message: `${rowLabel}: Fill at least 2 dimensions (Height/Width/Depth).` });
    }

    if (board) {
      const sheetText = String(boardSheetFor(board) || "").trim();
      const sizePair = parseSheetSizePair(sheetText);
      if (sizePair) {
        const maxEdge = Math.max(sizePair[0], sizePair[1]);
        const overs: string[] = [];
        if (height != null && height > maxEdge) overs.push("Height");
        if (width != null && width > maxEdge) overs.push("Width");
        if (depth != null && depth > maxEdge) overs.push("Depth");
        if (overs.length) {
          if (height != null && height > maxEdge) errors.push({ field: "height", message: `${rowLabel}: Height exceeds board sheet size (${sheetText}).` });
          if (width != null && width > maxEdge) errors.push({ field: "width", message: `${rowLabel}: Width exceeds board sheet size (${sheetText}).` });
          if (depth != null && depth > maxEdge) errors.push({ field: "depth", message: `${rowLabel}: Depth exceeds board sheet size (${sheetText}).` });
        }
      }
    }

    return errors;
  };

  const makeWarningMapForRow = (issues: CutlistValidationIssue[]) => {
    const out: Record<string, string> = {};
    for (const issue of issues) {
      if (!out[issue.field]) out[issue.field] = issue.message;
    }
    return out;
  };

  const flashCutlistWarningCells = (warnings: Record<string, Record<string, string>>) => {
    const flashMap: Record<string, boolean> = {};
    for (const [rowKey, rowWarnings] of Object.entries(warnings)) {
      for (const field of Object.keys(rowWarnings)) {
        flashMap[`${rowKey}::${field}`] = true;
      }
    }
    if (!Object.keys(flashMap).length) return;
    setCutlistFlashingCells(flashMap);
    setCutlistFlashPhaseOn(true);
    if (cutlistFlashIntervalRef.current) {
      window.clearInterval(cutlistFlashIntervalRef.current);
      cutlistFlashIntervalRef.current = null;
    }
    if (cutlistFlashTimeoutRef.current) {
      window.clearTimeout(cutlistFlashTimeoutRef.current);
    }
    let ticks = 0;
    cutlistFlashIntervalRef.current = window.setInterval(() => {
      ticks += 1;
      setCutlistFlashPhaseOn((prev) => !prev);
      if (ticks >= 6) {
        if (cutlistFlashIntervalRef.current) {
          window.clearInterval(cutlistFlashIntervalRef.current);
          cutlistFlashIntervalRef.current = null;
        }
      }
    }, 90);
    cutlistFlashTimeoutRef.current = window.setTimeout(() => {
      setCutlistFlashingCells({});
      setCutlistFlashPhaseOn(false);
      cutlistFlashTimeoutRef.current = null;
      if (cutlistFlashIntervalRef.current) {
        window.clearInterval(cutlistFlashIntervalRef.current);
        cutlistFlashIntervalRef.current = null;
      }
    }, 600);
  };

  const isFlashingCell = (rowKey: string, field: string) => Boolean(cutlistFlashingCells[`${rowKey}::${field}`]);
  const isFlashPhaseActiveForCell = (rowKey: string, field: string) =>
    isFlashingCell(rowKey, field) && cutlistFlashPhaseOn;
  const warningForCell = (rowKey: string, field: string) => cutlistCellWarnings[rowKey]?.[field] ?? "";
  const warningClassForCell = (rowKey: string, field: string) =>
    isFlashPhaseActiveForCell(rowKey, field) ? "animate-[pulse_0.18s_ease-in-out_3]" : "";
  const warningStyleForCell = (
    rowKey: string,
    field: string,
    base: { backgroundColor?: string; borderColor?: string; color?: string },
  ) =>
    isFlashPhaseActiveForCell(rowKey, field)
      ? {
          ...base,
          backgroundColor: "#FEF2F2",
          borderColor: "#F87171",
        }
      : base;
  const clearWarningForCell = (rowKey: string, field: string) => {
    setCutlistCellWarnings((prev) => {
      if (!prev[rowKey]?.[field]) return prev;
      const nextRow = { ...(prev[rowKey] || {}) };
      delete nextRow[field];
      const next = { ...prev };
      if (Object.keys(nextRow).length === 0) delete next[rowKey];
      else next[rowKey] = nextRow;
      return next;
    });
  };

  const persistCutlistRows = async (nextRows: CutlistRow[]) => {
    if (!project) return;
    const rows = serializeCutlistRowsForStorage(nextRows, isCabinetryPartType);
    const ok = await updateProjectPatch(project, { cutlist: { rows } });
    if (ok) {
      setProject((prevProject) =>
        prevProject
          ? {
              ...prevProject,
              cutlist: { rows },
            }
          : prevProject,
      );
    }
  };
  const persistInitialCutlistRows = async (nextRows: CutlistRow[]) => {
    if (!project) return;
    const rows = serializeCutlistRowsForStorage(nextRows, isCabinetryPartType);
    const nextSales = {
      ...salesPayload,
      initialCutlist: { rows },
    } as Record<string, unknown>;
    const nextProjectSettings = {
      ...((project.projectSettings ?? {}) as Record<string, unknown>),
      sales: nextSales,
    };
    const ok = await updateProjectPatch(project, {
      sales: nextSales,
      salesJson: JSON.stringify(nextSales),
      projectSettings: nextProjectSettings,
      projectSettingsJson: JSON.stringify(nextProjectSettings),
    });
    if (ok) {
      setProject((prevProject) =>
        prevProject
          ? {
              ...prevProject,
              projectSettings: {
                ...(prevProject.projectSettings ?? {}),
                sales: nextSales,
              },
            }
          : prevProject,
      );
    }
  };

  const addCutlistRow = async () => {
    const singleErrors = validateCutlistRowInput(
      cutlistEntry as Partial<CutlistRow>,
      String(cutlistEntry.partType || "").trim(),
      "Entry",
    );
    if (singleErrors.length) {
      const warnings = { single: makeWarningMapForRow(singleErrors) };
      setCutlistCellWarnings(warnings);
      flashCutlistWarningCells(warnings);
      logCutlistValidationIssues(singleErrors, cutlistEntry.partType);
      return;
    }
    setCutlistCellWarnings({});
    const isCabinetry = isCabinetryPartType(cutlistEntry.partType);
    const isDrawer = isDrawerPartType(cutlistEntry.partType);
    const drawerTokens = parseDrawerHeightTokens(String(cutlistEntry.height ?? ""));
    const defaults = defaultClashingForPartType(cutlistEntry.partType, cutlistEntry.board);
    const left = String(cutlistEntry.clashLeft ?? "").trim().toUpperCase() || defaults.left;
    const right = String(cutlistEntry.clashRight ?? "").trim().toUpperCase() || defaults.right;
    const row: CutlistRow = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      room: cutlistEntryRoom || "Project Cutlist",
      ...cutlistEntry,
      height: isDrawer ? formatDrawerHeightTokens(drawerTokens) : String(cutlistEntry.height ?? ""),
      quantity: isDrawer ? String(Math.max(1, drawerTokens.length)) : String(cutlistEntry.quantity ?? "1"),
      clashing: isCabinetry ? "" : joinClashing(left, right),
      clashLeft: isCabinetry ? "" : left,
      clashRight: isCabinetry ? "" : right,
      fixedShelf: isCabinetry ? String(cutlistEntry.fixedShelf ?? "") : "",
      adjustableShelf: isCabinetry ? String(cutlistEntry.adjustableShelf ?? "") : "",
      fixedShelfDrilling: isCabinetry ? normalizeDrillingValue(cutlistEntry.fixedShelfDrilling) : "No",
      adjustableShelfDrilling: isCabinetry ? normalizeDrillingValue(cutlistEntry.adjustableShelfDrilling) : "No",
      includeInNesting: true,
    };
    const next = [...cutlistRows, row];
    setCutlistRows(next);
    logCutlistActivity(`${row.name || "Part"} added to ${row.room || "Project Cutlist"}`, {
      partType: row.partType,
    });
    setCutlistEntry({
      partType: "",
      board: "",
      name: "",
      height: "",
      width: "",
      depth: "",
      quantity: "1",
      clashing: "",
      clashLeft: "",
      clashRight: "",
      fixedShelf: "",
      adjustableShelf: "",
      fixedShelfDrilling: "No",
      adjustableShelfDrilling: "No",
      information: "",
      grain: false,
      grainValue: "",
    });
    await persistCutlistRows(next);
  };

  const addDraftRowForPartType = (partType: string) => {
    setActiveCutlistPartType(partType);
    setCutlistDraftRows((prev) => {
      const last = prev[prev.length - 1];
      const seed = last
        ? { board: last.board, room: last.room, quantity: "" }
        : { board: cutlistBoardOptions[0] ?? "", quantity: "" };
      return [...prev, createDraftCutlistRow(partType, cutlistEntryRoom || defaultCutlistRoom, seed)];
    });
  };

  const onSelectCutlistEntryPartType = (partType: string) => {
    setCutlistEntry((prev) => {
      const defaults = defaultClashingForPartType(partType, prev.board);
      const clashLeft = defaults.left;
      const clashRight = defaults.right;
      return {
        ...prev,
        partType,
        clashLeft,
        clashRight,
        clashing: joinClashing(clashLeft, clashRight),
      };
    });
  };

  const onCutlistEntryBoardChange = (board: string) => {
    setCutlistEntry((prev) => {
      const defaults = defaultClashingForPartType(prev.partType, board);
      const currentLeft = String(prev.clashLeft ?? "").trim().toUpperCase();
      const currentRight = String(prev.clashRight ?? "").trim().toUpperCase();
      const lacquerBoard = !!(board && boardLacquerFor(String(board).trim()));
      const grainAllowed = !!(board && boardGrainFor(String(board).trim()));
      const clashLeft = lacquerBoard ? "" : currentLeft || defaults.left;
      const clashRight = lacquerBoard ? "" : currentRight || defaults.right;
      return {
        ...prev,
        board,
        grainValue: grainAllowed ? String(prev.grainValue ?? "") : "",
        grain: grainAllowed ? Boolean(String(prev.grainValue ?? "").trim()) : false,
        clashLeft,
        clashRight,
        clashing: joinClashing(clashLeft, clashRight),
      };
    });
  };

  const onDraftBoardChange = (id: string, board: string) => {
    setCutlistDraftRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const defaults = defaultClashingForPartType(row.partType, board);
        const currentLeft = String(row.clashLeft ?? "").trim().toUpperCase();
        const currentRight = String(row.clashRight ?? "").trim().toUpperCase();
        const lacquerBoard = !!(board && boardLacquerFor(String(board).trim()));
        const grainAllowed = !!(board && boardGrainFor(String(board).trim()));
        const clashLeft = lacquerBoard ? "" : currentLeft || defaults.left;
        const clashRight = lacquerBoard ? "" : currentRight || defaults.right;
        return {
          ...row,
          board,
          grainValue: grainAllowed ? String(row.grainValue ?? "") : "",
          grain: grainAllowed ? Boolean(String(row.grainValue ?? "").trim()) : false,
          clashLeft,
          clashRight,
          clashing: joinClashing(clashLeft, clashRight),
        };
      }),
    );
  };

  const updateDraftCutlistRow = (id: string, patch: Partial<CutlistDraftRow>) => {
    setCutlistDraftRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (isDrawerPartType(next.partType)) {
          const tokens = parseDrawerHeightTokens(String(next.height ?? ""));
          next.height = formatDrawerHeightTokens(tokens);
          next.quantity = String(Math.max(1, tokens.length));
        }
        return next;
      }),
    );
  };

  const updateDraftDrawerHeightTokens = (id: string, tokens: string[]) => {
    const formatted = formatDrawerHeightTokens(tokens);
    setCutlistDraftRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              height: formatted,
              quantity: String(Math.max(1, parseDrawerHeightTokens(formatted).length)),
            }
          : row,
      ),
    );
  };

  const addDraftDrawerHeightToken = (id: string, token: string) => {
    const row = cutlistDraftRows.find((r) => r.id === id);
    if (!row) return;
    const next = [...parseDrawerHeightTokens(String(row.height ?? "")), String(token || "").trim()].filter(Boolean);
    updateDraftDrawerHeightTokens(id, next);
  };

  const removeDraftDrawerHeightToken = (id: string, token: string) => {
    const row = cutlistDraftRows.find((r) => r.id === id);
    if (!row) return;
    const current = parseDrawerHeightTokens(String(row.height ?? ""));
    const idx = current.findIndex((item) => item.toLowerCase() === String(token || "").trim().toLowerCase());
    if (idx < 0) return;
    current.splice(idx, 1);
    updateDraftDrawerHeightTokens(id, current);
  };

  const setCutlistEntryDrawerHeightTokens = (tokens: string[]) => {
    const formatted = formatDrawerHeightTokens(tokens);
    setCutlistEntry((prev) => ({
      ...prev,
      height: formatted,
      quantity: String(Math.max(1, parseDrawerHeightTokens(formatted).length)),
    }));
  };

  const addCutlistEntryDrawerHeightToken = (token: string) => {
    const current = parseDrawerHeightTokens(String(cutlistEntry.height ?? ""));
    const next = [...current, String(token || "").trim()].filter(Boolean);
    setCutlistEntryDrawerHeightTokens(next);
  };

  const removeCutlistEntryDrawerHeightToken = (token: string) => {
    const current = parseDrawerHeightTokens(String(cutlistEntry.height ?? ""));
    const idx = current.findIndex((item) => item.toLowerCase() === String(token || "").trim().toLowerCase());
    if (idx < 0) return;
    current.splice(idx, 1);
    setCutlistEntryDrawerHeightTokens(current);
  };

  const addEditingDrawerHeightToken = (token: string) => {
    const next = [...parseDrawerHeightTokens(String(editingCellValue ?? "")), String(token || "").trim()].filter(Boolean);
    setEditingCellValue(formatDrawerHeightTokens(next));
  };

  const removeEditingDrawerHeightToken = (token: string) => {
    const next = parseDrawerHeightTokens(String(editingCellValue ?? ""));
    const idx = next.findIndex((item) => item.toLowerCase() === String(token || "").trim().toLowerCase());
    if (idx < 0) return;
    next.splice(idx, 1);
    setEditingCellValue(formatDrawerHeightTokens(next));
  };

  const setDraftInformationLines = (id: string, lines: string[]) => {
    const value = informationValueFromLines(lines);
    updateDraftCutlistRow(id, { information: value });
  };

  const onDraftInformationLineChange = (id: string, index: number, value: string) => {
    const row = cutlistDraftRows.find((r) => r.id === id);
    const lines = informationLinesFromValue(String(row?.information ?? ""));
    const next = [...lines];
    while (next.length <= index) next.push("");
    next[index] = value;
    setDraftInformationLines(id, next);
  };

  const onDraftAddInformationLine = (id: string) => {
    const row = cutlistDraftRows.find((r) => r.id === id);
    const lines = informationLinesFromValue(String(row?.information ?? ""));
    setDraftInformationLines(id, [...lines, ""]);
  };

  const onDraftRemoveInformationLine = (id: string, index: number) => {
    const row = cutlistDraftRows.find((r) => r.id === id);
    const lines = informationLinesFromValue(String(row?.information ?? ""));
    if (lines.length <= 1) {
      setDraftInformationLines(id, [""]);
      return;
    }
    const next = lines.filter((_, i) => i !== index);
    setDraftInformationLines(id, next.length ? next : [""]);
  };

  const removeDraftCutlistRow = (id: string) => {
    setCutlistDraftRows((prev) => prev.filter((row) => row.id !== id));
  };

  const addDraftRowsToCutlist = async () => {
    const rejectedIds = new Set<string>();
    const nextWarnings: Record<string, Record<string, string>> = {};
    const accepted = cutlistDraftRows
      .map((row, idx) => {
        const partType = String(row.partType || activeCutlistPartType || "").trim();
        const isCabinetry = isCabinetryPartType(partType);
        const isDrawer = isDrawerPartType(partType);
        const drawerTokens = parseDrawerHeightTokens(String(row.height ?? ""));
        const normalizedHeight = isDrawer ? formatDrawerHeightTokens(drawerTokens) : String(row.height || "").trim();
        const normalizedRow = {
          ...row,
          room: String(row.room || cutlistEntryRoom || defaultCutlistRoom),
          partType,
          board: String(row.board || "").trim(),
          name: String(row.name || "").trim(),
          height: normalizedHeight,
          quantity: isDrawer ? String(Math.max(1, drawerTokens.length)) : String(row.quantity ?? "").trim(),
          clashing: isCabinetry ? "" : joinClashing(String(row.clashLeft || ""), String(row.clashRight || "")),
          fixedShelf: isCabinetry ? String(row.fixedShelf || "") : "",
          adjustableShelf: isCabinetry ? String(row.adjustableShelf || "") : "",
          fixedShelfDrilling: isCabinetry ? normalizeDrillingValue(row.fixedShelfDrilling) : "No",
          adjustableShelfDrilling: isCabinetry ? normalizeDrillingValue(row.adjustableShelfDrilling) : "No",
          includeInNesting: row.includeInNesting !== false,
        };
        const rowErrors = validateCutlistRowInput(normalizedRow, partType, `Row ${idx + 1}`);
        if (rowErrors.length) {
          rejectedIds.add(row.id);
          nextWarnings[row.id] = makeWarningMapForRow(rowErrors);
          logCutlistValidationIssues(rowErrors, partType);
          return null;
        }
        return normalizedRow;
      })
      .filter(Boolean) as CutlistDraftRow[];
    setCutlistCellWarnings(nextWarnings);
    flashCutlistWarningCells(nextWarnings);
    if (!accepted.length) return;
    const nextRows: CutlistRow[] = [...cutlistRows, ...accepted.map((row) => ({ ...row, id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }))];
    for (const row of accepted) {
      logCutlistActivity(`${row.name || "Part"} added to ${row.room || "Project Cutlist"}`, {
        partType: row.partType,
      });
    }
    setCutlistRows(nextRows);
    if (rejectedIds.size > 0) {
      const rejectedRows = cutlistDraftRows.filter((row) => rejectedIds.has(row.id));
      setCutlistDraftRows(rejectedRows);
    } else {
      setCutlistDraftRows([]);
    }
    await persistCutlistRows(nextRows);
  };

  const removeCutlistRow = async (id: string) => {
    const removed = cutlistRows.find((row) => row.id === id);
    const next = cutlistRows.filter((row) => row.id !== id);
    setCutlistRows(next);
    if (removed) {
      logCutlistActivity(`${removed.name || "Part"} removed`, {
        partType: removed.partType,
      });
    }
    await persistCutlistRows(next);
  };
  const removeInitialCutlistRow = async (id: string) => {
    if (!salesAccess.edit) return;
    const removed = initialCutlistRows.find((row) => row.id === id);
    const next = initialCutlistRows.filter((row) => row.id !== id);
    setInitialCutlistRows(next);
    if (removed) {
      logCutlistActivity(`${removed.name || "Part"} removed`, { partType: removed.partType, scope: "initial" });
    }
    await persistInitialCutlistRows(next);
  };

  const toggleInitialPendingCutlistRowDelete = (partType: string, rowId: string) => {
    const groupKey = String(partType || "Unassigned").trim() || "Unassigned";
    const id = String(rowId || "").trim();
    if (!id) return;
    if (!salesAccess.edit) return;
    setInitialPendingDeleteRowsByGroup((prev) => {
      const existing = Array.isArray(prev[groupKey]) ? prev[groupKey] : [];
      const has = existing.includes(id);
      const next = has ? existing.filter((v) => v !== id) : [...existing, id];
      if (!next.length) {
        const { [groupKey]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [groupKey]: next };
    });
    setInitialDeleteConfirmArmedGroups((prev) => ({ ...prev, [groupKey]: false }));
  };

  const deletePendingInitialCutlistRowsForGroup = async (partType: string) => {
    const groupKey = String(partType || "Unassigned").trim() || "Unassigned";
    const pending = Array.isArray(initialPendingDeleteRowsByGroup[groupKey]) ? initialPendingDeleteRowsByGroup[groupKey] : [];
    if (!pending.length) return;
    if (!initialDeleteConfirmArmedGroups[groupKey]) {
      setInitialDeleteConfirmArmedGroups((prev) => ({ ...prev, [groupKey]: true }));
      return;
    }
    if (!salesAccess.edit) return;

    const pendingSet = new Set(pending);
    const removedRows = initialCutlistRows.filter((row) => pendingSet.has(row.id));
    const next = initialCutlistRows.filter((row) => !pendingSet.has(row.id));
    setInitialCutlistRows(next);
    for (const removed of removedRows) {
      logCutlistActivity(`${removed.name || "Part"} removed`, { partType: removed.partType, scope: "initial" });
    }
    setInitialPendingDeleteRowsByGroup((prev) => {
      const { [groupKey]: _removed, ...rest } = prev;
      return rest;
    });
    setInitialDeleteConfirmArmedGroups((prev) => ({ ...prev, [groupKey]: false }));
    await persistInitialCutlistRows(next);
  };

  const deletePendingInitialCutlistRows = async () => {
    const groupKeys = Object.keys(initialPendingDeleteRowsByGroup);
    const allPending = new Set<string>();
    for (const ids of Object.values(initialPendingDeleteRowsByGroup)) {
      for (const id of ids || []) {
        allPending.add(String(id || ""));
      }
    }
    const allPendingRows = Array.from(allPending).filter(Boolean);
    if (!allPendingRows.length) return;
    if (!initialDeleteAllArmed) {
      setInitialDeleteAllArmed(true);
      return;
    }
    if (!salesAccess.edit) return;
    const pendingSet = new Set(allPendingRows);
    const removedRows = initialCutlistRows.filter((row) => pendingSet.has(row.id));
    const next = initialCutlistRows.filter((row) => !pendingSet.has(row.id));
    setInitialCutlistRows(next);
    for (const removed of removedRows) {
      logCutlistActivity(`${removed.name || "Part"} removed`, { partType: removed.partType, scope: "initial" });
    }
    setInitialPendingDeleteRowsByGroup({});
    setInitialDeleteAllArmed(false);
    setInitialDeleteConfirmArmedGroups({});
    await persistInitialCutlistRows(next);
  };

  const addInitialCutlistRow = async () => {
    if (!project || !salesAccess.edit) return;
    const partType = String(initialCutlistEntry.partType || "").trim();
    if (!partType) return;
    const isCabinetry = isCabinetryPartType(partType);
    const isDrawer = isDrawerPartType(partType);
    const drawerTokens = parseDrawerHeightTokens(String(initialCutlistEntry.height ?? ""));
    const defaults = defaultClashingForPartType(partType, initialCutlistEntry.board);
    const left = String(initialCutlistEntry.clashLeft ?? "").trim().toUpperCase() || defaults.left;
    const right = String(initialCutlistEntry.clashRight ?? "").trim().toUpperCase() || defaults.right;
    const row: CutlistRow = {
      id: `im_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      room: initialCutlistEntryRoom || "Project Cutlist",
      ...initialCutlistEntry,
      partType,
      height: isDrawer ? formatDrawerHeightTokens(drawerTokens) : String(initialCutlistEntry.height ?? ""),
      quantity: isDrawer ? String(Math.max(1, drawerTokens.length)) : String(initialCutlistEntry.quantity ?? "1"),
      clashing: isCabinetry ? "" : joinClashing(left, right),
      clashLeft: isCabinetry ? "" : left,
      clashRight: isCabinetry ? "" : right,
      fixedShelf: isCabinetry ? String(initialCutlistEntry.fixedShelf ?? "") : "",
      adjustableShelf: isCabinetry ? String(initialCutlistEntry.adjustableShelf ?? "") : "",
      fixedShelfDrilling: isCabinetry ? normalizeDrillingValue(initialCutlistEntry.fixedShelfDrilling) : "No",
      adjustableShelfDrilling: isCabinetry ? normalizeDrillingValue(initialCutlistEntry.adjustableShelfDrilling) : "No",
      includeInNesting: false,
    };
    const next = [...initialCutlistRows, row];
    setInitialCutlistRows(next);
    setInitialCutlistEntry(createEmptyCutlistEntry());
    logCutlistActivity(`${row.name || "Part"} added to ${row.room || "Project Cutlist"}`, { partType: row.partType, scope: "initial" });
    await persistInitialCutlistRows(next);
  };

  const onInitialCutlistEntryBoardChange = (board: string) => {
    setInitialCutlistEntry((prev) => {
      const defaults = defaultClashingForPartType(prev.partType, board);
      const currentLeft = String(prev.clashLeft ?? "").trim().toUpperCase();
      const currentRight = String(prev.clashRight ?? "").trim().toUpperCase();
      const lacquerBoard = !!(board && boardLacquerFor(String(board).trim()));
      const grainAllowed = !!(board && initialMeasureBoardGrainFor(String(board).trim()));
      const clashLeft = lacquerBoard ? "" : currentLeft || defaults.left;
      const clashRight = lacquerBoard ? "" : currentRight || defaults.right;
      return {
        ...prev,
        board,
        grainValue: grainAllowed ? String(prev.grainValue ?? "") : "",
        grain: grainAllowed ? Boolean(String(prev.grainValue ?? "").trim()) : false,
        clashLeft,
        clashRight,
        clashing: joinClashing(clashLeft, clashRight),
      };
    });
  };

  const togglePendingCutlistRowDelete = (partType: string, rowId: string) => {
    const groupKey = String(partType || "Unassigned").trim() || "Unassigned";
    const id = String(rowId || "").trim();
    if (!id) return;
    setPendingDeleteRowsByGroup((prev) => {
      const existing = Array.isArray(prev[groupKey]) ? prev[groupKey] : [];
      const has = existing.includes(id);
      const next = has ? existing.filter((v) => v !== id) : [...existing, id];
      if (!next.length) {
        const { [groupKey]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [groupKey]: next };
    });
    setDeleteConfirmArmedGroups((prev) => ({ ...prev, [groupKey]: false }));
  };

  const deletePendingCutlistRowsForGroup = async (partType: string) => {
    const groupKey = String(partType || "Unassigned").trim() || "Unassigned";
    const pending = Array.isArray(pendingDeleteRowsByGroup[groupKey]) ? pendingDeleteRowsByGroup[groupKey] : [];
    if (!pending.length) return;
    if (!deleteConfirmArmedGroups[groupKey]) {
      setDeleteConfirmArmedGroups((prev) => ({ ...prev, [groupKey]: true }));
      return;
    }

    const pendingSet = new Set(pending);
    const removedRows = cutlistRows.filter((row) => pendingSet.has(row.id));
    const nextRows = cutlistRows.filter((row) => !pendingSet.has(row.id));
    setCutlistRows(nextRows);
    for (const removed of removedRows) {
      logCutlistActivity(`${removed.name || "Part"} removed`, { partType: removed.partType });
    }
    setPendingDeleteRowsByGroup((prev) => {
      const { [groupKey]: _removed, ...rest } = prev;
      return rest;
    });
    setDeleteConfirmArmedGroups((prev) => ({ ...prev, [groupKey]: false }));
    await persistCutlistRows(nextRows);
  };

  const addInitialDraftRowForPartType = (partType: string) => {
    setInitialActiveCutlistPartType(partType);
    setInitialCutlistDraftRows((prev) => {
      const last = prev[prev.length - 1];
      const seed = last
        ? { board: last.board, room: last.room, quantity: "" }
        : { board: initialMeasureBoardOptions[0] ?? "", quantity: "" };
      return [...prev, createDraftCutlistRow(partType, initialCutlistEntryRoom || defaultInitialCutlistRoom, seed)];
    });
  };

  const onInitialDraftBoardChange = (id: string, board: string) => {
    setInitialCutlistDraftRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const defaults = defaultClashingForPartType(row.partType, board);
        const currentLeft = String(row.clashLeft ?? "").trim().toUpperCase();
        const currentRight = String(row.clashRight ?? "").trim().toUpperCase();
        const lacquerBoard = !!(board && boardLacquerFor(String(board).trim()));
        const grainAllowed = !!(board && initialMeasureBoardGrainFor(String(board).trim()));
        const clashLeft = lacquerBoard ? "" : currentLeft || defaults.left;
        const clashRight = lacquerBoard ? "" : currentRight || defaults.right;
        return {
          ...row,
          board,
          grainValue: grainAllowed ? String(row.grainValue ?? "") : "",
          grain: grainAllowed ? Boolean(String(row.grainValue ?? "").trim()) : false,
          clashLeft,
          clashRight,
          clashing: joinClashing(clashLeft, clashRight),
        };
      }),
    );
  };

  const updateInitialDraftCutlistRow = (id: string, patch: Partial<CutlistDraftRow>) => {
    setInitialCutlistDraftRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (isDrawerPartType(next.partType)) {
          const tokens = parseDrawerHeightTokens(String(next.height ?? ""));
          next.height = formatDrawerHeightTokens(tokens);
          next.quantity = String(Math.max(1, tokens.length));
        }
        return next;
      }),
    );
  };

  const updateInitialDraftDrawerHeightTokens = (id: string, tokens: string[]) => {
    const formatted = formatDrawerHeightTokens(tokens);
    setInitialCutlistDraftRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              height: formatted,
              quantity: String(Math.max(1, parseDrawerHeightTokens(formatted).length)),
            }
          : row,
      ),
    );
  };

  const addInitialDraftDrawerHeightToken = (id: string, token: string) => {
    const row = initialCutlistDraftRows.find((r) => r.id === id);
    if (!row) return;
    const next = [...parseDrawerHeightTokens(String(row.height ?? "")), String(token || "").trim()].filter(Boolean);
    updateInitialDraftDrawerHeightTokens(id, next);
  };

  const removeInitialDraftDrawerHeightToken = (id: string, token: string) => {
    const row = initialCutlistDraftRows.find((r) => r.id === id);
    if (!row) return;
    const current = parseDrawerHeightTokens(String(row.height ?? ""));
    const idx = current.findIndex((item) => item.toLowerCase() === String(token || "").trim().toLowerCase());
    if (idx < 0) return;
    current.splice(idx, 1);
    updateInitialDraftDrawerHeightTokens(id, current);
  };

  const setInitialDraftInformationLines = (id: string, lines: string[]) => {
    const value = informationValueFromLines(lines);
    updateInitialDraftCutlistRow(id, { information: value });
  };

  const onInitialDraftInformationLineChange = (id: string, index: number, value: string) => {
    const row = initialCutlistDraftRows.find((r) => r.id === id);
    const lines = informationLinesFromValue(String(row?.information ?? ""));
    const next = [...lines];
    while (next.length <= index) next.push("");
    next[index] = value;
    setInitialDraftInformationLines(id, next);
  };

  const onInitialDraftAddInformationLine = (id: string) => {
    const row = initialCutlistDraftRows.find((r) => r.id === id);
    const lines = informationLinesFromValue(String(row?.information ?? ""));
    setInitialDraftInformationLines(id, [...lines, ""]);
  };

  const onInitialDraftRemoveInformationLine = (id: string, index: number) => {
    const row = initialCutlistDraftRows.find((r) => r.id === id);
    const lines = informationLinesFromValue(String(row?.information ?? ""));
    if (lines.length <= 1) {
      setInitialDraftInformationLines(id, [""]);
      return;
    }
    const next = lines.filter((_, i) => i !== index);
    setInitialDraftInformationLines(id, next.length ? next : [""]);
  };

  const removeInitialDraftCutlistRow = (id: string) => {
    setInitialCutlistDraftRows((prev) => prev.filter((row) => row.id !== id));
  };

  const addInitialDraftRowsToCutlist = async () => {
    if (!project || !salesAccess.edit) return;
    const accepted = initialCutlistDraftRows
      .map((row) => {
        const partType = String(row.partType || initialActiveCutlistPartType || "").trim();
        if (!partType) return null;
        const isCabinetry = isCabinetryPartType(partType);
        const isDrawer = isDrawerPartType(partType);
        const drawerTokens = parseDrawerHeightTokens(String(row.height ?? ""));
        const defaults = defaultClashingForPartType(partType, row.board);
        const left = String(row.clashLeft ?? "").trim().toUpperCase() || defaults.left;
        const right = String(row.clashRight ?? "").trim().toUpperCase() || defaults.right;
        return {
          ...row,
          id: `im_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          room: String(row.room || initialCutlistEntryRoom || defaultInitialCutlistRoom || "Project Cutlist"),
          partType,
          height: isDrawer ? formatDrawerHeightTokens(drawerTokens) : String(row.height ?? ""),
          quantity: isDrawer ? String(Math.max(1, drawerTokens.length)) : String(row.quantity ?? "1"),
          clashing: isCabinetry ? "" : joinClashing(left, right),
          clashLeft: isCabinetry ? "" : left,
          clashRight: isCabinetry ? "" : right,
          fixedShelf: isCabinetry ? String(row.fixedShelf ?? "") : "",
          adjustableShelf: isCabinetry ? String(row.adjustableShelf ?? "") : "",
          fixedShelfDrilling: isCabinetry ? normalizeDrillingValue(row.fixedShelfDrilling) : "No",
          adjustableShelfDrilling: isCabinetry ? normalizeDrillingValue(row.adjustableShelfDrilling) : "No",
          includeInNesting: false,
        } satisfies CutlistRow;
      })
      .filter(Boolean) as CutlistRow[];
    if (!accepted.length) return;
    const next = [...initialCutlistRows, ...accepted];
    setInitialCutlistRows(next);
    setInitialCutlistDraftRows([]);
    for (const row of accepted) {
      logCutlistActivity(`${row.name || "Part"} added to ${row.room || "Project Cutlist"}`, { partType: row.partType, scope: "initial" });
    }
    await persistInitialCutlistRows(next);
  };

  const onCutlistEntryInformationLineChange = (index: number, value: string) => {
    setCutlistEntry((prev) => {
      const lines = informationLinesFromValue(String(prev.information ?? ""));
      const next = [...lines];
      while (next.length <= index) next.push("");
      next[index] = value;
      return { ...prev, information: informationValueFromLines(next) };
    });
  };

  const onCutlistEntryAddInformationLine = () => {
    setCutlistEntry((prev) => {
      const lines = informationLinesFromValue(String(prev.information ?? ""));
      return { ...prev, information: informationValueFromLines([...lines, ""]) };
    });
  };

  const onCutlistEntryRemoveInformationLine = (index: number) => {
    setCutlistEntry((prev) => {
      const lines = informationLinesFromValue(String(prev.information ?? ""));
      if (lines.length <= 1) {
        return { ...prev, information: "" };
      }
      const next = lines.filter((_, i) => i !== index);
      return { ...prev, information: informationValueFromLines(next.length ? next : [""]) };
    });
  };

  const onEditingInformationLineChange = (index: number, value: string) => {
    const lines = informationLinesFromValue(String(editingCellValue ?? ""));
    const next = [...lines];
    while (next.length <= index) next.push("");
    next[index] = value;
    setEditingCellValue(informationValueFromLines(next));
  };

  const onEditingAddInformationLine = () => {
    const lines = informationLinesFromValue(String(editingCellValue ?? ""));
    setEditingCellValue(informationValueFromLines([...lines, ""]));
  };

  const onEditingRemoveInformationLine = (index: number) => {
    const lines = informationLinesFromValue(String(editingCellValue ?? ""));
    if (lines.length <= 1) {
      setEditingCellValue("");
      return;
    }
    const next = lines.filter((_, i) => i !== index);
    setEditingCellValue(informationValueFromLines(next.length ? next : [""]));
  };

  const effectiveCutlistRows = useMemo(() => {
    if (!editingCell) return cutlistRows;
    const target = editingCell;
    const value = String(editingCellValue ?? "");
    return cutlistRows.map((row) => {
      if (row.id !== target.rowId) return row;
      const updated: CutlistRow = { ...row };
      switch (target.key) {
        case "board":
          updated.board = value;
          if (!boardGrainFor(String(updated.board ?? "").trim())) {
            updated.grainValue = "";
            updated.grain = false;
          }
          break;
        case "grain":
          if (!boardGrainFor(String(updated.board ?? "").trim())) {
            updated.grainValue = "";
            updated.grain = false;
            break;
          }
          updated.grainValue = String(value ?? "").trim();
          updated.grain = Boolean(updated.grainValue);
          break;
        case "clashing":
          if (isCabinetryPartType(updated.partType)) {
            updated.clashing = "";
            updated.clashLeft = "";
            updated.clashRight = "";
            updated.fixedShelf = String(editingFixedShelfRef.current ?? "").trim();
            updated.adjustableShelf = String(editingAdjustableShelfRef.current ?? "").trim();
            updated.fixedShelfDrilling = normalizeDrillingValue(editingFixedShelfDrillingRef.current);
            updated.adjustableShelfDrilling = normalizeDrillingValue(editingAdjustableShelfDrillingRef.current);
          } else {
            updated.clashing = joinClashing(editingClashLeft, editingClashRight).trim().toUpperCase().replace(/\b2SH\b/g, "2S");
            const split = splitClashing(updated.clashing);
            updated.clashLeft = split.left;
            updated.clashRight = split.right;
            updated.fixedShelf = "";
            updated.adjustableShelf = "";
            updated.fixedShelfDrilling = "No";
            updated.adjustableShelfDrilling = "No";
          }
          break;
        case "room":
          updated.room = value || "Project Cutlist";
          break;
        case "partType":
          updated.partType = value;
          if (isCabinetryPartType(value)) {
            updated.clashing = "";
            updated.clashLeft = "";
            updated.clashRight = "";
            updated.fixedShelfDrilling = normalizeDrillingValue(updated.fixedShelfDrilling);
            updated.adjustableShelfDrilling = normalizeDrillingValue(updated.adjustableShelfDrilling);
          } else {
            updated.fixedShelf = "";
            updated.adjustableShelf = "";
            updated.fixedShelfDrilling = "No";
            updated.adjustableShelfDrilling = "No";
            updated.clashing = joinClashing(String(updated.clashLeft ?? ""), String(updated.clashRight ?? ""));
          }
          if (isDrawerPartType(value)) {
            const tokens = parseDrawerHeightTokens(String(updated.height ?? ""));
            updated.height = formatDrawerHeightTokens(tokens);
            updated.quantity = String(Math.max(1, tokens.length));
          }
          break;
        case "height":
          if (isDrawerPartType(updated.partType)) {
            const tokens = parseDrawerHeightTokens(value);
            updated.height = formatDrawerHeightTokens(tokens);
            updated.quantity = String(Math.max(1, tokens.length));
          } else {
            updated.height = value;
          }
          break;
        default:
          updated[target.key] = value;
          break;
      }
      return updated;
    });
  }, [
    boardGrainFor,
    cutlistRows,
    editingAdjustableShelf,
    editingAdjustableShelfDrilling,
    editingCell,
    editingCellValue,
    editingClashLeft,
    editingClashRight,
    editingFixedShelf,
    editingFixedShelfDrilling,
    isCabinetryPartType,
    isDrawerPartType,
  ]);

  const visibleCutlistRows = useMemo(() => {
    const search = cutlistSearch.trim().toLowerCase();
    return effectiveCutlistRows.filter((row) => {
      const roomOk = cutlistRoomFilter === "Project Cutlist" ? true : row.room === cutlistRoomFilter;
      const typeOk = cutlistPartTypeFilter === "All Part Types" || row.partType === cutlistPartTypeFilter;
      const searchOk =
        !search ||
        [row.name, row.board, row.partType, row.information].some((v) => String(v || "").toLowerCase().includes(search));
      return roomOk && typeOk && searchOk;
    });
  }, [effectiveCutlistRows, cutlistPartTypeFilter, cutlistSearch, cutlistRoomFilter]);
  const visibleInitialCutlistRows = useMemo(() => {
    const search = initialCutlistSearch.trim().toLowerCase();
    return initialCutlistRows.filter((row) => {
      const roomOk = initialCutlistRoomFilter === "Project Cutlist" ? true : row.room === initialCutlistRoomFilter;
      const typeOk = initialCutlistPartTypeFilter === "All Part Types" || row.partType === initialCutlistPartTypeFilter;
      const searchOk =
        !search ||
        [row.name, row.board, row.partType, row.information].some((v) => String(v || "").toLowerCase().includes(search));
      return roomOk && typeOk && searchOk;
    });
  }, [initialCutlistPartTypeFilter, initialCutlistRoomFilter, initialCutlistRows, initialCutlistSearch]);
  const initialPendingDeleteRowsSet = useMemo(() => {
    const set = new Set<string>();
    for (const ids of Object.values(initialPendingDeleteRowsByGroup || {})) {
      for (const id of ids || []) {
        const normalized = String(id || "").trim();
        if (normalized) set.add(normalized);
      }
    }
    return set;
  }, [initialPendingDeleteRowsByGroup]);

  const visibleRowsAllCabinetry = useMemo(
    () => visibleCutlistRows.length > 0 && visibleCutlistRows.every((row) => isCabinetryPartType(row.partType)),
    [visibleCutlistRows],
  );

  const flatListShowsShelvesHeader = useMemo(
    () =>
      (cutlistPartTypeFilter !== "All Part Types" && isCabinetryPartType(cutlistPartTypeFilter)) ||
      visibleRowsAllCabinetry,
    [cutlistPartTypeFilter, visibleRowsAllCabinetry],
  );

  const draftEntryShowsShelvesHeader = useMemo(() => {
    if (cutlistDraftRows.length) {
      return cutlistDraftRows.every((row) => isCabinetryPartType(row.partType));
    }
    return isCabinetryPartType(activeCutlistPartType || cutlistEntry.partType);
  }, [activeCutlistPartType, cutlistDraftRows, cutlistEntry.partType]);
  const initialDraftEntryShowsShelvesHeader = useMemo(() => {
    if (initialCutlistDraftRows.length) {
      return initialCutlistDraftRows.every((row) => isCabinetryPartType(row.partType));
    }
    return isCabinetryPartType(initialActiveCutlistPartType || initialCutlistEntry.partType);
  }, [initialActiveCutlistPartType, initialCutlistDraftRows, initialCutlistEntry.partType]);

  const singleEntryShowsShelvesHeader = useMemo(
    () => isCabinetryPartType(cutlistEntry.partType),
    [cutlistEntry.partType],
  );
  const singleEntryHeightGrainMatch = useMemo(
    () => matchesGrainDimension(String(cutlistEntry.grainValue ?? ""), cutlistEntry.height, "height"),
    [cutlistEntry.grainValue, cutlistEntry.height],
  );
  const singleEntryWidthGrainMatch = useMemo(
    () => matchesGrainDimension(String(cutlistEntry.grainValue ?? ""), cutlistEntry.width, "width"),
    [cutlistEntry.grainValue, cutlistEntry.width],
  );
  const singleEntryDepthGrainMatch = useMemo(
    () => matchesGrainDimension(String(cutlistEntry.grainValue ?? ""), cutlistEntry.depth, "depth"),
    [cutlistEntry.grainValue, cutlistEntry.depth],
  );

  useEffect(() => {
    if (!isDrawerPartType(cutlistEntry.partType)) return;
    const qty = String(Math.max(1, parseDrawerHeightTokens(String(cutlistEntry.height ?? "")).length));
    if (cutlistEntry.quantity === qty) return;
    setCutlistEntry((prev) => ({ ...prev, quantity: qty }));
  }, [cutlistEntry.height, cutlistEntry.partType, cutlistEntry.quantity, isDrawerPartType]);
  useEffect(() => {
    if (!isDrawerPartType(initialCutlistEntry.partType)) return;
    const qty = String(Math.max(1, parseDrawerHeightTokens(String(initialCutlistEntry.height ?? "")).length));
    if (initialCutlistEntry.quantity === qty) return;
    setInitialCutlistEntry((prev) => ({ ...prev, quantity: qty }));
  }, [initialCutlistEntry.height, initialCutlistEntry.partType, initialCutlistEntry.quantity, isDrawerPartType]);

  const groupedCutlistRows = useMemo(() => {
    const grouped = new Map<string, CutlistRow[]>();
    for (const row of visibleCutlistRows) {
      const key = String(row.partType || "Unassigned");
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    const rank = new Map(partTypeOptions.map((name, idx) => [name, idx]));
    return Array.from(grouped.entries())
      .sort((a, b) => {
        const ar = rank.has(a[0]) ? Number(rank.get(a[0])) : 999;
        const br = rank.has(b[0]) ? Number(rank.get(b[0])) : 999;
        return ar - br || a[0].localeCompare(b[0]);
      })
      .map(([partType, rows]) => ({ partType, rows }));
  }, [visibleCutlistRows, partTypeOptions]);
  const groupedInitialCutlistRows = useMemo(() => {
    const grouped = new Map<string, CutlistRow[]>();
    for (const row of visibleInitialCutlistRows) {
      const key = String(row.partType || "Unassigned");
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    const rank = new Map(initialMeasurePartTypeOptions.map((name, idx) => [name, idx]));
    return Array.from(grouped.entries())
      .sort((a, b) => {
        const ar = rank.has(a[0]) ? Number(rank.get(a[0])) : 999;
        const br = rank.has(b[0]) ? Number(rank.get(b[0])) : 999;
        return ar - br || a[0].localeCompare(b[0]);
      })
      .map(([partType, rows]) => ({ partType, rows }));
  }, [initialMeasurePartTypeOptions, visibleInitialCutlistRows]);

  useEffect(() => {
    setPendingDeleteRowsByGroup((prev) => {
      const validRowIds = new Set(cutlistRows.map((row) => row.id));
      let changed = false;
      const next: Record<string, string[]> = {};
      for (const [groupKey, ids] of Object.entries(prev)) {
        const filtered = (ids || []).filter((id) => validRowIds.has(id));
        if (filtered.length) next[groupKey] = filtered;
        if (filtered.length !== (ids || []).length) changed = true;
      }
      return changed ? next : prev;
    });
    setDeleteConfirmArmedGroups((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [groupKey, armed] of Object.entries(prev)) {
        if ((pendingDeleteRowsByGroup[groupKey] || []).length > 0) {
          next[groupKey] = armed;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setInitialPendingDeleteRowsByGroup((prev) => {
      const validRowIds = new Set(initialCutlistRows.map((row) => row.id));
      let changed = false;
      const next: Record<string, string[]> = {};
      for (const [groupKey, ids] of Object.entries(prev)) {
        const filtered = (ids || []).filter((id) => validRowIds.has(id));
        if (filtered.length) next[groupKey] = filtered;
        if (filtered.length !== (ids || []).length) changed = true;
      }
      return changed ? next : prev;
    });
    setInitialDeleteConfirmArmedGroups((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [groupKey, armed] of Object.entries(prev)) {
        if ((initialPendingDeleteRowsByGroup[groupKey] || []).length > 0) {
          next[groupKey] = armed;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [cutlistRows, pendingDeleteRowsByGroup, initialCutlistRows, initialPendingDeleteRowsByGroup]);

  const cncSourceRows = useMemo(() => {
    return effectiveCutlistRows.filter((row) => isPartTypeIncludedInCnc(row.partType));
  }, [effectiveCutlistRows, isPartTypeIncludedInCnc]);

  const cncExpandedRows = useMemo(() => {
    const out: CncDisplayRow[] = [];
    for (const row of cncSourceRows) {
      const visible = typeof cncVisibilityMap[row.id] === "boolean" ? cncVisibilityMap[row.id] : true;
      if (!visible) continue;

      if (isCabinetryPartType(row.partType)) {
        const mainQty = Math.max(0, Number.parseInt(String(row.quantity || "0"), 10) || 0);
        if (mainQty <= 0) continue;
        const fixedTotal = Math.max(0, Math.floor(toNum(row.fixedShelf)));
        const adjustableTotal = Math.max(0, Math.floor(toNum(row.adjustableShelf)));

        out.push({
          ...row,
          id: `${row.id}__cab__main`,
          sourceRowId: row.id,
          cncCabinetryRowKind: "main",
        });

        out.push({
          ...row,
          id: `${row.id}__cab__fixed`,
          sourceRowId: row.id,
          cncCabinetryRowKind: "fixedShelf",
          name: "Fixed Shelf",
          height: "",
          width: "",
          depth: "",
          quantity: fixedTotal > 0 ? String(fixedTotal) : "",
          clashing: "",
          clashLeft: "",
          clashRight: "",
          information: "",
        });
        out.push({
          ...row,
          id: `${row.id}__cab__adjustable`,
          sourceRowId: row.id,
          cncCabinetryRowKind: "adjustableShelf",
          name: "Adjustable Shelf",
          height: "",
          width: "",
          depth: "",
          quantity: adjustableTotal > 0 ? String(adjustableTotal) : "",
          clashing: "",
          clashLeft: "",
          clashRight: "",
          information: "",
        });
        continue;
      }

      if (isDrawerPartType(row.partType)) {
        const pieces = buildDrawerDerivedPieces(row);
        const mainName = String(row.name || "").trim();
        for (const piece of pieces) {
          const qty = Math.max(0, Number.parseInt(String(piece.quantity || "0"), 10) || 0);
          if (qty <= 0) continue;
          const pieceName = String(piece.partName || "").trim();
          const combinedName =
            mainName && pieceName
              ? `${mainName} - ${pieceName}`
              : [mainName, pieceName].filter(Boolean).join("").trim();
          out.push({
            ...row,
            id: `${row.id}__drw__${piece.key}`,
            sourceRowId: row.id,
            name: combinedName || row.name,
            parentName: String(row.name || ""),
            height: String(piece.height || ""),
            width: String(piece.width || ""),
            depth: String(piece.depth || ""),
            quantity: String(qty),
            clashing: joinClashing(String(piece.clashLeft || ""), String(piece.clashRight || "")),
            clashLeft: String(piece.clashLeft || ""),
            clashRight: String(piece.clashRight || ""),
            information: String(row.information || ""),
          });
        }
        continue;
      }

      const qty = Math.max(0, Number.parseInt(String(row.quantity || "0"), 10) || 0);
      if (qty <= 0) continue;
      out.push({ ...row, sourceRowId: row.id });
    }
    return out;
  }, [
    cncSourceRows,
    cncVisibilityMap,
    isCabinetryPartType,
    isDrawerPartType,
    buildCabinetryDerivedPieces,
    buildDrawerDerivedPieces,
  ]);

  const filteredCncRows = useMemo(() => {
    const q = String(cncSearch || "").trim().toLowerCase();
    return cncExpandedRows.filter((row) => {
      const typeOk = cncPartTypeFilter === "All Part Types" || row.partType === cncPartTypeFilter;
      if (!typeOk) return false;
      if (!q) return true;
      return [row.room, row.partType, row.board, row.name, row.information]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [cncExpandedRows, cncPartTypeFilter, cncSearch]);

  const cncRowsByBoard = useMemo(() => {
    const rank = new Map(partTypeOptions.map((name, idx) => [name, idx]));
    const pieceKindRank = (name: string) => {
      const txt = String(name || "").toLowerCase();
      if (/\bbottom\b/.test(txt)) return 0;
      if (/\bback\b/.test(txt)) return 1;
      return 2;
    };
    const map = new Map<string, { boardKey: string; boardLabel: string; rows: CncDisplayRow[] }>();
    for (const row of filteredCncRows) {
      const boardKey = String(row.board || "").trim() || "Unknown Board";
      const boardLabel = boardDisplayLabel(boardKey) || boardKey || "Unknown Board";
      const hit = map.get(boardKey);
      if (hit) {
        hit.rows.push(row);
      } else {
        map.set(boardKey, { boardKey, boardLabel, rows: [row] });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => a.boardLabel.localeCompare(b.boardLabel))
      .map((group) => ({
        ...group,
        rows: [...group.rows].sort((a, b) => {
          const aCab = isCabinetryPartType(a.partType) ? 1 : 0;
          const bCab = isCabinetryPartType(b.partType) ? 1 : 0;
          const aDrw = isDrawerPartType(a.partType) ? 1 : 0;
          const bDrw = isDrawerPartType(b.partType) ? 1 : 0;
          const ar = rank.has(a.partType) ? Number(rank.get(a.partType)) : 999;
          const br = rank.has(b.partType) ? Number(rank.get(b.partType)) : 999;
          if (aCab !== bCab) return aCab - bCab;
          if (aCab === 1 && bCab === 1) {
            const bySource = String(a.sourceRowId || "").localeCompare(String(b.sourceRowId || ""));
            if (bySource !== 0) return bySource;
            const kindRank = (kind: CncDisplayRow["cncCabinetryRowKind"]) => {
              if (kind === "fixedShelf") return 1;
              if (kind === "adjustableShelf") return 2;
              return 0;
            };
            const ak = kindRank(a.cncCabinetryRowKind);
            const bk = kindRank(b.cncCabinetryRowKind);
            if (ak !== bk) return ak - bk;
          }
          if (aDrw === 1 && bDrw === 1) {
            const bySource = String(a.sourceRowId || "").localeCompare(String(b.sourceRowId || ""));
            if (bySource !== 0) return bySource;
          }
          return (
            ar - br ||
            pieceKindRank(a.name) - pieceKindRank(b.name) ||
            String(a.name || "").localeCompare(String(b.name || "")) ||
            String(a.id).localeCompare(String(b.id))
          );
        }),
      }));
  }, [filteredCncRows, partTypeOptions, boardDisplayLabel, isCabinetryPartType, isDrawerPartType]);
  const cncRowsByBoardNonCab = useMemo(
    () =>
      cncRowsByBoard
        .map((group) => ({
          ...group,
          rows: group.rows.filter((row) => !isCabinetryPartType(row.partType)),
        }))
        .filter((group) => group.rows.length > 0),
    [cncRowsByBoard, isCabinetryPartType],
  );
  const cncNonCabDisplayIdCount = useMemo(() => {
    let count = 0;
    let lastIdKey = "";
    for (const group of cncRowsByBoardNonCab) {
      for (const row of group.rows) {
        const isDrawer = isDrawerPartType(row.partType);
        const idKey = isDrawer
          ? String((row as CncDisplayRow).sourceRowId || row.id)
          : String(row.id);
        if (idKey !== lastIdKey) {
          count += 1;
          lastIdKey = idKey;
        }
      }
    }
    return count;
  }, [cncRowsByBoardNonCab, isDrawerPartType]);
  const cncCabinetCards = useMemo(() => {
    const q = String(cncSearch || "").trim().toLowerCase();
    const rows = cncSourceRows.filter((row) => {
      const visible = typeof cncVisibilityMap[row.id] === "boolean" ? cncVisibilityMap[row.id] : true;
      if (!visible) return false;
      if (!isCabinetryPartType(row.partType)) return false;
      const qty = Math.max(0, Number.parseInt(String(row.quantity || "0"), 10) || 0);
      if (qty <= 0) return false;
      const typeOk = cncPartTypeFilter === "All Part Types" || row.partType === cncPartTypeFilter;
      if (!typeOk) return false;
      if (!q) return true;
      return [
        row.room,
        row.partType,
        row.board,
        row.name,
        row.information,
        row.fixedShelf,
        row.adjustableShelf,
        row.height,
        row.width,
        row.depth,
      ]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
    const sorted = [...rows].sort((a, b) =>
      String(boardDisplayLabel(a.board) || "").localeCompare(String(boardDisplayLabel(b.board) || "")) ||
      String(a.name || "").localeCompare(String(b.name || "")) ||
      String(a.id || "").localeCompare(String(b.id || "")),
    );
    return sorted.map((row, idx) => ({
      cabinetryPieces: (() => {
        const out: Record<string, CabinetryDerivedPiece | undefined> = {};
        for (const p of buildCabinetryDerivedPieces(row)) out[p.key] = p;
        return out;
      })(),
      row,
      displayId: cncNonCabDisplayIdCount + idx + 1,
      boardLabel: boardDisplayLabel(row.board) || String(row.board || "-"),
      thicknessMm: (() => {
        const fromRow = Math.max(0, boardThicknessFor(String(row.board || "").trim()));
        if (fromRow > 0) return fromRow;
        const label = String(boardDisplayLabel(row.board) || row.board || "");
        const m = label.match(/(\d+(?:\.\d+)?)\s*mm/i);
        return m ? Math.max(0, Number.parseFloat(m[1] || "0")) : 0;
      })(),
      heightMm: Math.max(0, toNum(row.height)),
      widthMm: Math.max(0, toNum(row.width)),
      depthMm: Math.max(0, toNum(row.depth)),
      sizeLabel: [String(row.height || "").trim(), String(row.width || "").trim(), String(row.depth || "").trim()]
        .filter(Boolean)
        .join(" x "),
      fixedShelf: Math.max(0, Math.floor(toNum(row.fixedShelf))),
      adjustableShelf: Math.max(0, Math.floor(toNum(row.adjustableShelf))),
      infoLines: informationLinesFromValue(String(row.information || "")),
    }));
  }, [
    cncSearch,
    cncSourceRows,
    cncVisibilityMap,
    cncPartTypeFilter,
    isCabinetryPartType,
    boardDisplayLabel,
    boardThicknessFor,
    buildCabinetryDerivedPieces,
    cncNonCabDisplayIdCount,
  ]);
  const cabinetPdfImageCacheRef = useRef<Record<string, { url: string; svgW: number; svgH: number }>>({});
  const cabinetPdfImageKey = (card: (typeof cncCabinetCards)[number]) =>
    `${String(card.row.id)}|${card.widthMm}|${card.heightMm}|${card.depthMm}|${card.thicknessMm}|${card.fixedShelf}|${card.adjustableShelf}`;
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const entries = await Promise.all(
        cncCabinetCards.map(async (card) => {
          const key = cabinetPdfImageKey(card);
          const svg = buildCabinetSvgForExport(
            card.widthMm,
            card.heightMm,
            card.depthMm,
            card.thicknessMm,
            card.fixedShelf,
            card.adjustableShelf,
          );
          if (!svg) return [key, null] as const;
          const url = await cabinetSvgMarkupToPngDataUrl(
            svg.svg,
            Math.max(120, Math.floor(svg.svgW * 2)),
            Math.max(120, Math.floor(svg.svgH * 2)),
          );
          if (!url) return [key, null] as const;
          return [key, { url, svgW: svg.svgW, svgH: svg.svgH }] as const;
        }),
      );
      if (cancelled) return;
      const next: Record<string, { url: string; svgW: number; svgH: number }> = {};
      for (const [key, value] of entries) {
        if (value) next[key] = value;
      }
      cabinetPdfImageCacheRef.current = next;
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [cncCabinetCards]);
  const cncRoomColumnPx = useMemo(() => {
    const maxContentPx = Math.max(
      approximateTextWidthPx("Room"),
      ...cncExpandedRows.map((row) => approximateTextWidthPx(String(row.room || ""))),
    );
    return Math.max(75, Math.min(420, Math.ceil(maxContentPx + 50)));
  }, [cncExpandedRows]);
  const cncPartNameColumnPx = useMemo(() => {
    const maxContentPx = Math.max(
      approximateTextWidthPx("Part Name"),
      ...cncExpandedRows.map((row) => approximateTextWidthPx(String(row.name || ""))),
    );
    return Math.max(75, Math.min(760, Math.ceil(maxContentPx + 50)));
  }, [cncExpandedRows]);

  const cncVisibilityRows = useMemo(() => {
    const q = String(cncVisibilitySearch || "").trim().toLowerCase();
    return cncSourceRows.filter((row) => {
      if (!q) return true;
      return [row.room, row.partType, row.board, row.name, row.information]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [cncSourceRows, cncVisibilitySearch]);

  const cncSidebarGroups = useMemo(() => {
    const rank = new Map(partTypeOptions.map((name, idx) => [String(name || "").trim(), idx]));
    const grouped = new Map<string, CutlistRow[]>();
    for (const row of cncVisibilityRows) {
      const key = String(row.partType || "Unassigned").trim() || "Unassigned";
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    return Array.from(grouped.entries())
      .map(([partType, rows]) => ({
        partType,
        rows: [...rows].sort((a, b) => {
          const byBoard = String(boardDisplayLabel(a.board) || "").localeCompare(String(boardDisplayLabel(b.board) || ""));
          if (byBoard !== 0) return byBoard;
          const byName = String(a.name || "").localeCompare(String(b.name || ""));
          if (byName !== 0) return byName;
          return String(a.room || "").localeCompare(String(b.room || ""));
        }),
      }))
      .sort((a, b) => {
        const ar = rank.has(a.partType) ? Number(rank.get(a.partType)) : 999;
        const br = rank.has(b.partType) ? Number(rank.get(b.partType)) : 999;
        return ar - br || a.partType.localeCompare(b.partType);
      });
  }, [boardDisplayLabel, cncVisibilityRows, partTypeOptions]);

  const nestingSettings = useMemo(() => {
    const rawRoot = (companyDoc ?? {}) as Record<string, unknown>;
    const rawNested = ((rawRoot.nestingSettings ?? rawRoot.nesting) ?? {}) as Record<string, unknown>;
    const sheetHeight = Math.max(100, toNum(rawNested.sheetHeight ?? rawNested.h ?? 2440) || 2440);
    const sheetWidth = Math.max(100, toNum(rawNested.sheetWidth ?? rawNested.w ?? 1220) || 1220);
    const kerf = Math.max(0, toNum(rawNested.kerf ?? 5) || 5);
    const margin = Math.max(0, toNum(rawNested.margin ?? 10) || 10);
    return { sheetHeight, sheetWidth, kerf, margin };
  }, [companyDoc]);

  const nestingVisibleRows = useMemo(() => {
    const q = String(nestingSearch || "").trim().toLowerCase();
    const expanded: CutlistRow[] = [];
    for (const row of effectiveCutlistRows) {
      if (!isPartTypeIncludedInNesting(row.partType)) continue;
      const visible = typeof nestingVisibilityMap[row.id] === "boolean" ? nestingVisibilityMap[row.id] : row.includeInNesting !== false;
      if (!visible) continue;

      if (isCabinetryPartType(row.partType)) {
        const pieces = buildCabinetryDerivedPieces(row);
        for (const piece of pieces) {
          const qty = Math.max(0, Number.parseInt(String(piece.quantity || "0"), 10) || 0);
          if (qty <= 0) continue;
          const nestedRow: CutlistRow = {
            ...row,
            id: `${row.id}__cab__${piece.key}`,
            name: piece.partName || row.name,
            parentName: String(row.name || ""),
            height: String(piece.height || ""),
            width: String(piece.width || ""),
            depth: String(piece.depth || ""),
            quantity: String(qty),
            clashing: joinClashing(String(piece.clashLeft || ""), String(piece.clashRight || "")),
            clashLeft: String(piece.clashLeft || ""),
            clashRight: String(piece.clashRight || ""),
            information: String(row.information || ""),
          };
          if (
            !q ||
            [nestedRow.name, nestedRow.board, nestedRow.partType, nestedRow.room, nestedRow.information]
              .some((v) => String(v || "").toLowerCase().includes(q))
          ) {
            expanded.push(nestedRow);
          }
        }
        continue;
      }

      if (isDrawerPartType(row.partType)) {
        const pieces = buildDrawerDerivedPieces(row);
        for (const piece of pieces) {
          const qty = Math.max(0, Number.parseInt(String(piece.quantity || "0"), 10) || 0);
          if (qty <= 0) continue;
          const nestedRow: CutlistRow = {
            ...row,
            id: `${row.id}__drw__${piece.key}`,
            name: piece.partName || row.name,
            parentName: String(row.name || ""),
            height: String(piece.height || ""),
            width: String(piece.width || ""),
            depth: String(piece.depth || ""),
            quantity: String(qty),
            clashing: joinClashing(String(piece.clashLeft || ""), String(piece.clashRight || "")),
            clashLeft: String(piece.clashLeft || ""),
            clashRight: String(piece.clashRight || ""),
            information: String(row.information || ""),
          };
          if (
            !q ||
            [nestedRow.name, nestedRow.board, nestedRow.partType, nestedRow.room, nestedRow.information]
              .some((v) => String(v || "").toLowerCase().includes(q))
          ) {
            expanded.push(nestedRow);
          }
        }
        continue;
      }

      if (
        !q ||
        [row.name, row.board, row.partType, row.room, row.information]
          .some((v) => String(v || "").toLowerCase().includes(q))
      ) {
        expanded.push(row);
      }
    }
    return expanded;
  }, [
    buildCabinetryDerivedPieces,
    buildDrawerDerivedPieces,
    effectiveCutlistRows,
    isCabinetryPartType,
    isDrawerPartType,
    isPartTypeIncludedInNesting,
    nestingSearch,
    nestingVisibilityMap,
  ]);

  const nestingRowsForSheetCount = useMemo(() => {
    const expanded: CutlistRow[] = [];
    for (const row of effectiveCutlistRows) {
      if (!isPartTypeIncludedInNesting(row.partType)) continue;

      if (isCabinetryPartType(row.partType)) {
        const pieces = buildCabinetryDerivedPieces(row);
        for (const piece of pieces) {
          const qty = Math.max(0, Number.parseInt(String(piece.quantity || "0"), 10) || 0);
          if (qty <= 0) continue;
          expanded.push({
            ...row,
            id: `${row.id}__cab__${piece.key}`,
            name: piece.partName || row.name,
            parentName: String(row.name || ""),
            height: String(piece.height || ""),
            width: String(piece.width || ""),
            depth: String(piece.depth || ""),
            quantity: String(qty),
            clashing: joinClashing(String(piece.clashLeft || ""), String(piece.clashRight || "")),
            clashLeft: String(piece.clashLeft || ""),
            clashRight: String(piece.clashRight || ""),
            information: String(row.information || ""),
          });
        }
        continue;
      }

      if (isDrawerPartType(row.partType)) {
        const pieces = buildDrawerDerivedPieces(row);
        for (const piece of pieces) {
          const qty = Math.max(0, Number.parseInt(String(piece.quantity || "0"), 10) || 0);
          if (qty <= 0) continue;
          expanded.push({
            ...row,
            id: `${row.id}__drw__${piece.key}`,
            name: piece.partName || row.name,
            parentName: String(row.name || ""),
            height: String(piece.height || ""),
            width: String(piece.width || ""),
            depth: String(piece.depth || ""),
            quantity: String(qty),
            clashing: joinClashing(String(piece.clashLeft || ""), String(piece.clashRight || "")),
            clashLeft: String(piece.clashLeft || ""),
            clashRight: String(piece.clashRight || ""),
            information: String(row.information || ""),
          });
        }
        continue;
      }

      expanded.push(row);
    }
    return expanded;
  }, [
    buildCabinetryDerivedPieces,
    buildDrawerDerivedPieces,
    effectiveCutlistRows,
    isCabinetryPartType,
    isDrawerPartType,
    isPartTypeIncludedInNesting,
  ]);

  const nestingRowsByBoard = useMemo(() => {
    const grouped = new Map<string, CutlistRow[]>();
    for (const row of nestingVisibleRows) {
      const key = resolveBoardKey(String(row.board || "")) || boardDisplayLabel(row.board) || "Unassigned Board";
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    return Array.from(grouped.entries())
      .map(([boardKey, rows]) => ({
        boardKey,
        boardLabel: boardDisplayLabel(boardKey) || boardKey,
        rows: [...rows].sort((a, b) => {
          const byType = String(a.partType || "").localeCompare(String(b.partType || ""));
          if (byType !== 0) return byType;
          return String(a.name || "").localeCompare(String(b.name || ""));
        }),
      }))
      .sort((a, b) => a.boardLabel.localeCompare(b.boardLabel) || a.boardKey.localeCompare(b.boardKey));
  }, [boardDisplayLabel, nestingVisibleRows, resolveBoardKey]);
  const nestingRowsByBoardForSheetCount = useMemo(() => {
    const grouped = new Map<string, CutlistRow[]>();
    for (const row of nestingRowsForSheetCount) {
      const key = resolveBoardKey(String(row.board || "")) || boardDisplayLabel(row.board) || "Unassigned Board";
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    return Array.from(grouped.entries())
      .map(([boardKey, rows]) => ({
        boardKey,
        boardLabel: boardDisplayLabel(boardKey) || boardKey,
        rows: [...rows].sort((a, b) => {
          const byType = String(a.partType || "").localeCompare(String(b.partType || ""));
          if (byType !== 0) return byType;
          return String(a.name || "").localeCompare(String(b.name || ""));
        }),
      }))
      .sort((a, b) => a.boardLabel.localeCompare(b.boardLabel) || a.boardKey.localeCompare(b.boardKey));
  }, [boardDisplayLabel, nestingRowsForSheetCount, resolveBoardKey]);

  const nestingSidebarGroups = useMemo(() => {
    const q = String(nestingSearch || "").trim().toLowerCase();
    const filtered = effectiveCutlistRows.filter((row) => {
      if (!isPartTypeIncludedInNesting(row.partType)) return false;
      if (!q) return true;
      return [row.name, row.board, row.partType, row.room, row.information]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });

    const grouped = new Map<string, CutlistRow[]>();
    for (const row of filtered) {
      const key = String(row.partType || "Unassigned").trim() || "Unassigned";
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }

    return Array.from(grouped.entries())
      .map(([partType, rows]) => ({
        partType,
        rows: [...rows].sort((a, b) => {
          const byName = String(a.name || "").localeCompare(String(b.name || ""));
          if (byName !== 0) return byName;
          const byBoard = String(boardDisplayLabel(a.board) || "").localeCompare(String(boardDisplayLabel(b.board) || ""));
          if (byBoard !== 0) return byBoard;
          return String(a.room || "").localeCompare(String(b.room || ""));
        }),
      }))
      .sort((a, b) => a.partType.localeCompare(b.partType));
  }, [boardDisplayLabel, effectiveCutlistRows, isPartTypeIncludedInNesting, nestingSearch]);

  const nestingBoardLayouts = useMemo(() => {
    type FlatPiece = {
      id: string;
      rowId: string;
      row: CutlistRow;
      name: string;
      partType: string;
      room: string;
      width: number;
      height: number;
      area: number;
    };
    type SheetPlacement = {
      piece: FlatPiece;
      x: number;
      y: number;
      w: number;
      h: number;
    };
    type SheetLayout = { index: number; placements: SheetPlacement[] };

    const toPositiveNum = (v: unknown) => {
      const n = Number.parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };

    const parseBoardSize = (boardKey: string, fallbackW: number, fallbackH: number) => {
      const resolved = resolveBoardKey(boardKey);
      const raw =
        String(boardSheetByLabel[resolved] ?? "") ||
        String(boardKey).split("@@")[1]?.trim() ||
        "";
      const match = raw.match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
      if (!match) {
        return { width: fallbackW, height: fallbackH, pill: `${(fallbackW / 1000).toFixed(1)}` };
      }
      const a = Number.parseFloat(match[1]);
      const b = Number.parseFloat(match[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        return { width: fallbackW, height: fallbackH, pill: `${(fallbackW / 1000).toFixed(1)}` };
      }
      const width = Math.max(a, b);
      const height = Math.min(a, b);
      return { width, height, pill: `${(width / 1000).toFixed(1)}` };
    };

    return nestingRowsByBoard.map((group) => {
      const parsed = parseBoardSize(group.boardKey, nestingSettings.sheetHeight, nestingSettings.sheetWidth);
      const sheetWidth = Math.max(200, parsed.width);
      const sheetHeight = Math.max(150, parsed.height);
      const innerW = Math.max(80, sheetWidth - nestingSettings.margin * 2);
      const innerH = Math.max(80, sheetHeight - nestingSettings.margin * 2);
      const kerf = Math.max(0, nestingSettings.kerf);

      const pieces: FlatPiece[] = [];
      for (const row of group.rows) {
        const qty = Math.max(1, Number.parseInt(String(row.quantity || "1"), 10) || 1);
        const dimH = toPositiveNum(row.height);
        const dimW = toPositiveNum(row.width);
        const dimD = toPositiveNum(row.depth);
        const grainDim = toPositiveNum(row.grainValue);
        let width = dimW || dimD || 120;
        let height = dimH || dimD || 80;

        if (grainDim > 0) {
          const allDims = [dimH, dimW, dimD].filter((v) => v > 0);
          const hasGrainMatch = allDims.some((v) => Math.abs(v - grainDim) < 0.001);
          if (hasGrainMatch) {
            const crossCandidates = allDims.filter((v) => Math.abs(v - grainDim) >= 0.001);
            const cross = (crossCandidates.length ? Math.max(...crossCandidates) : 0) || dimW || dimH || dimD || 80;
            width = grainDim;
            height = cross;
          }
        }
        const partType = String(row.partType || "Unassigned");
        const room = String(row.room || "Unassigned");
        const name = String(row.name || "Part");
        for (let i = 0; i < qty; i += 1) {
          pieces.push({
            id: `${row.id}_${i + 1}`,
            rowId: row.id,
            row,
            name,
            partType,
            room,
            width: Math.max(30, width),
            height: Math.max(24, height),
            area: Math.max(1, width * height),
          });
        }
      }

      const sorted = [...pieces].sort((a, b) => b.area - a.area);
      const sheets: SheetLayout[] = [];
      let current: SheetLayout = { index: 1, placements: [] };
      let x = 0;
      let y = 0;
      let rowMax = 0;

      const startNewSheet = () => {
        if (current.placements.length > 0) sheets.push(current);
        current = { index: sheets.length + 1, placements: [] };
        x = 0;
        y = 0;
        rowMax = 0;
      };

      for (const piece of sorted) {
        let w = piece.width;
        let h = piece.height;
        const grainLocked = toPositiveNum(piece.row.grainValue) > 0;

        if (!grainLocked) {
          const canNormalFit = w <= innerW && h <= innerH;
          const canRotatedFit = h <= innerW && w <= innerH;
          const preferLongOnSheetLong = innerW >= innerH ? h > w : w > h;

          if (canRotatedFit && (!canNormalFit || preferLongOnSheetLong)) {
            const nextW = h;
            const nextH = w;
            w = nextW;
            h = nextH;
          } else if (!canNormalFit && !canRotatedFit) {
            const normalOverflow = Math.max(0, w - innerW) + Math.max(0, h - innerH);
            const rotatedOverflow = Math.max(0, h - innerW) + Math.max(0, w - innerH);
            if (rotatedOverflow < normalOverflow) {
              const nextW = h;
              const nextH = w;
              w = nextW;
              h = nextH;
            }
          }
        }

        w = Math.min(w, innerW);
        h = Math.min(h, innerH);

        if (x > 0 && x + w > innerW) {
          x = 0;
          y += rowMax + kerf;
          rowMax = 0;
        }
        if (y > 0 && y + h > innerH) {
          startNewSheet();
        }
        if (x > 0 && x + w > innerW) {
          x = 0;
          y += rowMax + kerf;
          rowMax = 0;
        }
        if (y > 0 && y + h > innerH) {
          startNewSheet();
        }

        current.placements.push({ piece, x, y, w, h });
        x += w + kerf;
        rowMax = Math.max(rowMax, h);
      }

      if (current.placements.length > 0) {
        sheets.push(current);
      }

      return {
        boardKey: group.boardKey,
        boardLabel: group.boardLabel,
        boardPill: parsed.pill,
        sheetWidth,
        sheetHeight,
        innerW,
        innerH,
        sheets,
      };
    });
  }, [nestingRowsByBoard, nestingSettings.kerf, nestingSettings.margin, nestingSettings.sheetHeight, nestingSettings.sheetWidth, boardSheetByLabel, resolveBoardKey]);
  const nestingBoardLayoutsForSheetCount = useMemo(() => {
    type FlatPiece = {
      id: string;
      rowId: string;
      row: CutlistRow;
      name: string;
      partType: string;
      room: string;
      width: number;
      height: number;
      area: number;
    };
    type SheetPlacement = {
      piece: FlatPiece;
      x: number;
      y: number;
      w: number;
      h: number;
    };
    type SheetLayout = { index: number; placements: SheetPlacement[] };

    const toPositiveNum = (v: unknown) => {
      const n = Number.parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };

    const parseBoardSize = (boardKey: string, fallbackW: number, fallbackH: number) => {
      const resolved = resolveBoardKey(boardKey);
      const raw =
        String(boardSheetByLabel[resolved] ?? "") ||
        String(boardKey).split("@@")[1]?.trim() ||
        "";
      const match = raw.match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
      if (!match) {
        return { width: fallbackW, height: fallbackH, pill: `${(fallbackW / 1000).toFixed(1)}` };
      }
      const a = Number.parseFloat(match[1]);
      const b = Number.parseFloat(match[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        return { width: fallbackW, height: fallbackH, pill: `${(fallbackW / 1000).toFixed(1)}` };
      }
      const width = Math.max(a, b);
      const height = Math.min(a, b);
      return { width, height, pill: `${(width / 1000).toFixed(1)}` };
    };

    return nestingRowsByBoardForSheetCount.map((group) => {
      const parsed = parseBoardSize(group.boardKey, nestingSettings.sheetHeight, nestingSettings.sheetWidth);
      const sheetWidth = Math.max(200, parsed.width);
      const sheetHeight = Math.max(150, parsed.height);
      const innerW = Math.max(80, sheetWidth - nestingSettings.margin * 2);
      const innerH = Math.max(80, sheetHeight - nestingSettings.margin * 2);
      const kerf = Math.max(0, nestingSettings.kerf);

      const pieces: FlatPiece[] = [];
      for (const row of group.rows) {
        const qty = Math.max(1, Number.parseInt(String(row.quantity || "1"), 10) || 1);
        const dimH = toPositiveNum(row.height);
        const dimW = toPositiveNum(row.width);
        const dimD = toPositiveNum(row.depth);
        const grainDim = toPositiveNum(row.grainValue);
        let width = dimW || dimD || 120;
        let height = dimH || dimD || 80;

        if (grainDim > 0) {
          const allDims = [dimH, dimW, dimD].filter((v) => v > 0);
          const hasGrainMatch = allDims.some((v) => Math.abs(v - grainDim) < 0.001);
          if (hasGrainMatch) {
            const crossCandidates = allDims.filter((v) => Math.abs(v - grainDim) >= 0.001);
            const cross = (crossCandidates.length ? Math.max(...crossCandidates) : 0) || dimW || dimH || dimD || 80;
            width = grainDim;
            height = cross;
          }
        }
        const partType = String(row.partType || "Unassigned");
        const room = String(row.room || "Unassigned");
        const name = String(row.name || "Part");
        for (let i = 0; i < qty; i += 1) {
          pieces.push({
            id: `${row.id}_${i + 1}`,
            rowId: row.id,
            row,
            name,
            partType,
            room,
            width: Math.max(30, width),
            height: Math.max(24, height),
            area: Math.max(1, width * height),
          });
        }
      }

      const sorted = [...pieces].sort((a, b) => b.area - a.area);
      const sheets: SheetLayout[] = [];
      let current: SheetLayout = { index: 1, placements: [] };
      let x = 0;
      let y = 0;
      let rowMax = 0;

      const startNewSheet = () => {
        if (current.placements.length > 0) sheets.push(current);
        current = { index: sheets.length + 1, placements: [] };
        x = 0;
        y = 0;
        rowMax = 0;
      };

      for (const piece of sorted) {
        let w = piece.width;
        let h = piece.height;
        const grainLocked = toPositiveNum(piece.row.grainValue) > 0;

        if (!grainLocked) {
          const canNormalFit = w <= innerW && h <= innerH;
          const canRotatedFit = h <= innerW && w <= innerH;
          const preferLongOnSheetLong = innerW >= innerH ? h > w : w > h;
          if (canRotatedFit && (!canNormalFit || preferLongOnSheetLong)) {
            const nextW = h;
            const nextH = w;
            w = nextW;
            h = nextH;
          } else if (!canNormalFit && !canRotatedFit) {
            const normalOverflow = Math.max(0, w - innerW) + Math.max(0, h - innerH);
            const rotatedOverflow = Math.max(0, h - innerW) + Math.max(0, w - innerH);
            if (rotatedOverflow < normalOverflow) {
              const nextW = h;
              const nextH = w;
              w = nextW;
              h = nextH;
            }
          }
        }

        w = Math.min(w, innerW);
        h = Math.min(h, innerH);

        if (x > 0 && x + w > innerW) {
          x = 0;
          y += rowMax + kerf;
          rowMax = 0;
        }
        if (y > 0 && y + h > innerH) {
          startNewSheet();
        }
        if (x > 0 && x + w > innerW) {
          x = 0;
          y += rowMax + kerf;
          rowMax = 0;
        }
        if (y > 0 && y + h > innerH) {
          startNewSheet();
        }

        current.placements.push({ piece, x, y, w, h });
        x += w + kerf;
        rowMax = Math.max(rowMax, h);
      }

      if (current.placements.length > 0) sheets.push(current);

      return {
        boardKey: group.boardKey,
        boardLabel: group.boardLabel,
        boardPill: parsed.pill,
        sheetWidth,
        sheetHeight,
        innerW,
        innerH,
        sheets,
      };
    });
  }, [nestingRowsByBoardForSheetCount, nestingSettings.kerf, nestingSettings.margin, nestingSettings.sheetHeight, nestingSettings.sheetWidth, boardSheetByLabel, resolveBoardKey]);

  const nestingSummary = useMemo(() => {
    const totalPieces = nestingVisibleRows.reduce((sum, row) => sum + Math.max(1, Number.parseInt(String(row.quantity || "1"), 10) || 1), 0);
    const hiddenPieces = cutlistRows.length - nestingVisibleRows.length;
    const sheets = Math.max(0, nestingBoardLayouts.reduce((sum, group) => sum + group.sheets.length, 0));
    return { totalPieces, hiddenPieces, sheets };
  }, [cutlistRows.length, nestingBoardLayouts, nestingVisibleRows]);
  const requiredSheetCountByBoardKey = useMemo(() => {
    const out: Record<string, number> = {};
    for (const group of nestingBoardLayoutsForSheetCount) {
      out[group.boardKey] = group.sheets.length;
    }
    return out;
  }, [nestingBoardLayoutsForSheetCount]);
  const requiredSheetCountByBoardRowId = useMemo(() => {
    const out: Record<string, number> = {};
    for (const boardRow of productionForm.boardTypes) {
      const rowKey = resolveBoardKey(boardKeyFromRow(boardRow));
      out[boardRow.id] = rowKey ? (requiredSheetCountByBoardKey[rowKey] ?? 0) : 0;
    }
    return out;
  }, [productionForm.boardTypes, requiredSheetCountByBoardKey, resolveBoardKey]);
  const edgebandingSettings = useMemo(
    () => normalizeEdgebandingSettings((companyDoc as Record<string, unknown> | null)?.edgebandingSettings),
    [companyDoc],
  );
  const requiredEdgetapeByBoardRowId = useMemo(() => {
    const out: Record<string, string> = {};
    const excessPerEndMm = Math.max(
      0,
      Number.parseFloat(String(edgebandingSettings.excessPerEndMm || "").replace(/,/g, ".")) || 0,
    );
    const rules = [...(edgebandingSettings.rules || [])]
      .map((rule) => ({
        upToMeters: Math.max(0, Number.parseFloat(String(rule.upToMeters || "").replace(/,/g, ".")) || 0),
        addMeters: Math.max(0, Number.parseFloat(String(rule.addMeters || "").replace(/,/g, ".")) || 0),
      }))
      .filter((rule) => rule.upToMeters > 0 && rule.addMeters >= 0)
      .sort((a, b) => a.upToMeters - b.upToMeters);
    const roundEnabled = Boolean(edgebandingSettings.roundEnabled);
    const roundDirection: "up" | "down" = edgebandingSettings.roundDirection === "down" ? "down" : "up";
    const roundNearestMeters = Math.max(
      0,
      Number.parseFloat(String(edgebandingSettings.roundNearestMeters || "").replace(/,/g, ".")) || 0,
    );

    const rowsForEdgeTape: CutlistRow[] = [];
    for (const row of effectiveCutlistRows) {
      if (isCabinetryPartType(row.partType)) {
        const pieces = buildCabinetryDerivedPieces(row);
        for (const piece of pieces) {
          const qty = Math.max(0, Number.parseInt(String(piece.quantity || "0"), 10) || 0);
          if (qty <= 0) continue;
          rowsForEdgeTape.push({
            ...row,
            height: String(piece.height || ""),
            width: String(piece.width || ""),
            depth: String(piece.depth || ""),
            quantity: String(qty),
            clashLeft: String(piece.clashLeft || ""),
            clashRight: String(piece.clashRight || ""),
          });
        }
        continue;
      }
      if (isDrawerPartType(row.partType)) {
        const pieces = buildDrawerDerivedPieces(row);
        for (const piece of pieces) {
          const qty = Math.max(0, Number.parseInt(String(piece.quantity || "0"), 10) || 0);
          if (qty <= 0) continue;
          rowsForEdgeTape.push({
            ...row,
            height: String(piece.height || ""),
            width: String(piece.width || ""),
            depth: String(piece.depth || ""),
            quantity: String(qty),
            clashLeft: String(piece.clashLeft || ""),
            clashRight: String(piece.clashRight || ""),
          });
        }
        continue;
      }
      rowsForEdgeTape.push(row);
    }

    const mmByBoardKey: Record<string, number> = {};
    const parseDim = (value: unknown): number => {
      const match = String(value ?? "").replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
      if (!match) return 0;
      const n = Number.parseFloat(match[0]);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const addTapeFromToken = (tokenRaw: string, longDim: number, shortDim: number, qty: number): number => {
      const token = String(tokenRaw || "").trim().toUpperCase();
      if (!token) return 0;
      if (!["1L", "2L", "1S", "2S"].includes(token)) return 0;
      const isLong = token.endsWith("L");
      const edgeCount = token.startsWith("2") ? 2 : 1;
      const dim = isLong ? longDim : shortDim;
      if (!Number.isFinite(dim) || dim <= 0 || qty <= 0) return 0;
      const edgeWithExcess = dim + excessPerEndMm * 2;
      return edgeWithExcess * qty * edgeCount;
    };

    for (const row of rowsForEdgeTape) {
      const boardKey = resolveBoardKey(String(row.board || ""));
      if (!boardKey) continue;
      const qty = Math.max(0, Number.parseInt(String(row.quantity || "0"), 10) || 0);
      if (qty <= 0) continue;
      const dims = [parseDim(row.height), parseDim(row.width), parseDim(row.depth)].filter((v) => v > 0);
      if (!dims.length) continue;
      const longDim = Math.max(...dims);
      const shortDim = Math.min(...dims);
      const split = splitClashing(String(row.clashing || ""));
      const left = String(row.clashLeft || split.left || "").trim().toUpperCase();
      const right = String(row.clashRight || split.right || "").trim().toUpperCase();
      const rowMm = addTapeFromToken(left, longDim, shortDim, qty) + addTapeFromToken(right, longDim, shortDim, qty);
      if (rowMm <= 0) continue;
      mmByBoardKey[boardKey] = (mmByBoardKey[boardKey] ?? 0) + rowMm;
    }

    const formatMeters = (meters: number) => {
      const rounded = Math.round(Math.max(0, meters) * 100) / 100;
      return rounded % 1 === 0 ? String(Math.round(rounded)) : String(rounded.toFixed(2).replace(/\.?0+$/, ""));
    };

    for (const boardRow of productionForm.boardTypes) {
      const boardKey = resolveBoardKey(boardKeyFromRow(boardRow));
      if (!boardKey) {
        out[boardRow.id] = "";
        continue;
      }
      const baseMeters = (mmByBoardKey[boardKey] ?? 0) / 1000;
      let extraMeters = 0;
      if (baseMeters > 0) {
        const matchRule = rules.find((rule) => baseMeters <= rule.upToMeters);
        if (matchRule) extraMeters = matchRule.addMeters;
      }
      let finalMeters = baseMeters + extraMeters;
      if (finalMeters > 0 && roundEnabled && roundNearestMeters > 0) {
        const ratio = finalMeters / roundNearestMeters;
        finalMeters = (roundDirection === "down" ? Math.floor(ratio) : Math.ceil(ratio)) * roundNearestMeters;
      }
      out[boardRow.id] = finalMeters > 0 ? formatMeters(finalMeters) : "";
    }
    return out;
  }, [
    productionForm.boardTypes,
    edgebandingSettings.excessPerEndMm,
    edgebandingSettings.rules,
    edgebandingSettings.roundEnabled,
    edgebandingSettings.roundDirection,
    edgebandingSettings.roundNearestMeters,
    effectiveCutlistRows,
    isCabinetryPartType,
    isDrawerPartType,
    buildCabinetryDerivedPieces,
    buildDrawerDerivedPieces,
    resolveBoardKey,
  ]);
  const toggleNestingGroup = (key: string) => {
    setNestingCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const onToggleNestingVisibility = (rowId: string, checked: boolean) => {
    setNestingVisibilityMap((prev) => ({ ...prev, [rowId]: checked }));
  };

  const onShowAllNestingRows = () => {
    setNestingVisibilityMap(Object.fromEntries(cutlistRows.map((row) => [row.id, true])));
  };

  const toggleCncGroup = (groupKey: string) => {
    setCncCollapsedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const onToggleCncVisibility = (rowId: string, checked: boolean) => {
    setCncVisibilityMap((prev) => ({ ...prev, [rowId]: checked }));
  };

  const onShowAllCncRows = () => {
    setCncVisibilityMap(Object.fromEntries(cncSourceRows.map((row) => [row.id, true])));
  };

  const toggleCutlistGroup = (groupKey: string) => {
    setCollapsedCutlistGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };
  const toggleInitialCutlistGroup = (groupKey: string) => {
    setInitialCollapsedCutlistGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const cutlistColumnDefs = useMemo(
    () =>
      cutlistColumns
      .map((label) => {
        const key = label.toLowerCase().replace(/\s+/g, "");
        if (key.includes("parttype") || key === "part") return { label, key: "partType" as const };
        if (key === "board") return { label, key: "board" as const };
        if (key.includes("partname") || key === "name") return { label, key: "name" as const };
        if (key.includes("height")) return { label, key: "height" as const };
        if (key.includes("width")) return { label, key: "width" as const };
        if (key.includes("depth")) return { label, key: "depth" as const };
        if (key.includes("quantity")) return { label, key: "quantity" as const };
        if (key.includes("clashing")) return { label, key: "clashing" as const };
        if (key.includes("information")) return { label, key: "information" as const };
        if (key.includes("grain")) return { label, key: "grain" as const };
        return { label, key: "information" as const };
      })
      .filter((col) => (col.key === "grain" ? showCutlistGrainColumn : true)),
    [cutlistColumns, showCutlistGrainColumn],
  );
  const initialCutlistColumnDefs = useMemo(
    () =>
      initialCutlistColumns
        .map((label) => {
          const key = label.toLowerCase().replace(/\s+/g, "");
          if (key.includes("parttype") || key === "part") return { label, key: "partType" as const };
          if (key === "board") return { label, key: "board" as const };
          if (key.includes("partname") || key === "name") return { label, key: "name" as const };
          if (key.includes("height")) return { label, key: "height" as const };
          if (key.includes("width")) return { label, key: "width" as const };
          if (key.includes("depth")) return { label, key: "depth" as const };
          if (key.includes("quantity")) return { label, key: "quantity" as const };
          if (key.includes("clashing")) return { label, key: "clashing" as const };
          if (key.includes("information")) return { label, key: "information" as const };
          if (key.includes("grain")) return { label, key: "grain" as const };
          return { label, key: "information" as const };
        })
        .filter((col) => (col.key === "grain" ? showInitialCutlistGrainColumn : true)),
    [initialCutlistColumns, showInitialCutlistGrainColumn],
  );
  const showRoomColumnInList = cutlistRoomFilter === "Project Cutlist";
  const showRoomColumnInInitialList = initialCutlistRoomFilter === "Project Cutlist";
  const cutlistListColumnDefs = useMemo(() => {
    if (showRoomColumnInList) return cutlistColumnDefs;
    const hasPartType = cutlistColumnDefs.some((col) => col.key === "partType");
    if (hasPartType) return cutlistColumnDefs;
    return [{ label: "Part", key: "partType" as const }, ...cutlistColumnDefs];
  }, [cutlistColumnDefs, showRoomColumnInList]);
  const initialCutlistListColumnDefs = useMemo(() => {
    const hasPartType = initialCutlistColumnDefs.some((col) => col.key === "partType");
    if (hasPartType) return initialCutlistColumnDefs;
    return [{ label: "Part", key: "partType" as const }, ...initialCutlistColumnDefs];
  }, [initialCutlistColumnDefs]);
  const cutlistEntryColumnDefs = useMemo(
    () => cutlistColumnDefs.filter((col) => col.key !== "partType"),
    [cutlistColumnDefs],
  );
  const initialCutlistEntryColumnDefs = useMemo(
    () => initialCutlistColumnDefs.filter((col) => col.key !== "partType"),
    [initialCutlistColumnDefs],
  );
  const cutlistEntryOrderMap = useMemo(() => {
    const map = new Map<CutlistEditableField, number>();
    cutlistEntryColumnDefs.forEach((col, idx) => map.set(col.key, idx + 1));
    return map;
  }, [cutlistEntryColumnDefs]);
  const initialCutlistEntryOrderMap = useMemo(() => {
    const map = new Map<CutlistEditableField, number>();
    initialCutlistEntryColumnDefs.forEach((col, idx) => map.set(col.key, idx + 1));
    return map;
  }, [initialCutlistEntryColumnDefs]);
  const cutlistEntryGridTemplate = useMemo(() => {
    const cols = ["28px"];
    cutlistEntryColumnDefs.forEach((col) => {
      if (col.key === "board" || col.key === "name") {
        cols.push("230px");
      } else if (col.key === "height" || col.key === "width" || col.key === "depth" || col.key === "quantity") {
        cols.push("70px");
      } else if (col.key === "clashing") {
        cols.push("84px", "84px");
      } else if (col.key === "information") {
        cols.push("minmax(216px,1fr)");
      } else if (col.key === "grain") {
        cols.push("96px");
      }
    });
    return cols.join(" ");
  }, [cutlistEntryColumnDefs]);
  const initialCutlistEntryGridTemplate = useMemo(() => {
    const cols = ["28px"];
    initialCutlistEntryColumnDefs.forEach((col) => {
      if (col.key === "board" || col.key === "name") {
        cols.push("230px");
      } else if (col.key === "height" || col.key === "width" || col.key === "depth" || col.key === "quantity") {
        cols.push("70px");
      } else if (col.key === "clashing") {
        cols.push("84px", "84px");
      } else if (col.key === "information") {
        cols.push("minmax(216px,1fr)");
      } else if (col.key === "grain") {
        cols.push("96px");
      }
    });
    return cols.join(" ");
  }, [initialCutlistEntryColumnDefs]);
  const cutlistEntryCellStyle = (key: CutlistEditableField, span = 1) => {
    const order = cutlistEntryOrderMap.get(key);
    if (order == null) return { display: "none" };
    return {
      order: order * 10,
      gridColumn: `span ${span} / span ${span}`,
    };
  };
  const cutlistEntrySubCellStyle = (key: CutlistEditableField, offset: number) => {
    const order = cutlistEntryOrderMap.get(key);
    if (order == null) return { display: "none" };
    return { order: order * 10 + offset };
  };

const cutlistListColumnStyle = (key: CutlistEditableField) => {
  switch (key) {
    case "partType":
      return { width: 116, minWidth: 116, maxWidth: 116 };
    case "board":
      return { width: 230, minWidth: 230, maxWidth: 230 };
    case "name":
      return { width: 230, minWidth: 230, maxWidth: 230 };
    case "height":
    case "width":
    case "depth":
    case "quantity":
      return { width: 70, minWidth: 70, maxWidth: 70 };
    case "clashing":
      return { width: 168, minWidth: 168, maxWidth: 168 };
    case "grain":
      return { width: 96, minWidth: 96, maxWidth: 96 };
      case "information":
        return { minWidth: 216 };
      default:
        return {};
    }
  };

  const isCenteredCutlistColumn = (key: CutlistEditableField) =>
    key === "height" ||
    key === "width" ||
    key === "depth" ||
    key === "quantity" ||
    key === "clashing" ||
    key === "grain";

  const cutlistHeaderAlignClass = (key: CutlistEditableField) => (isCenteredCutlistColumn(key) ? "text-center" : "text-left");
  const cutlistCellAlignClass = (key: CutlistEditableField) => (isCenteredCutlistColumn(key) ? "text-center" : "text-left");

  const startCellEdit = (row: CutlistRow, key: CutlistEditableField, infoLineIndex?: number) => {
    setEditingCell({ rowId: row.id, key });
    if (key === "information") {
      setEditingInfoFocusLine({ rowId: row.id, lineIndex: Math.max(0, Number(infoLineIndex ?? 0)) });
    } else {
      setEditingInfoFocusLine(null);
    }
    if (key === "clashing") {
      if (isCabinetryPartType(row.partType)) {
        const nextFixedShelf = String(row.fixedShelf ?? "");
        const nextAdjustableShelf = String(row.adjustableShelf ?? "");
        const nextFixedShelfDrilling = normalizeDrillingValue(row.fixedShelfDrilling);
        const nextAdjustableShelfDrilling = normalizeDrillingValue(row.adjustableShelfDrilling);
        editingFixedShelfRef.current = nextFixedShelf;
        editingAdjustableShelfRef.current = nextAdjustableShelf;
        editingFixedShelfDrillingRef.current = nextFixedShelfDrilling;
        editingAdjustableShelfDrillingRef.current = nextAdjustableShelfDrilling;
        setEditingFixedShelf(nextFixedShelf);
        setEditingAdjustableShelf(nextAdjustableShelf);
        setEditingFixedShelfDrilling(nextFixedShelfDrilling);
        setEditingAdjustableShelfDrilling(nextAdjustableShelfDrilling);
        setEditingCellValue("");
      } else {
        const split = splitClashing(row.clashing);
        setEditingClashLeft(split.left);
        setEditingClashRight(split.right);
        setEditingCellValue(row.clashing ?? "");
      }
      return;
    }
    if (key === "grain") {
      if (!boardGrainFor(String(row.board ?? "").trim())) return;
      setEditingCellValue(String(row.grainValue ?? "").trim());
      return;
    }
    setEditingCellValue(String(row[key] ?? ""));
  };

  const cancelCellEdit = () => {
    setEditingCell(null);
    setEditingCellValue("");
    setEditingClashLeft("");
    setEditingClashRight("");
    editingFixedShelfRef.current = "";
    editingAdjustableShelfRef.current = "";
    editingFixedShelfDrillingRef.current = "No";
    editingAdjustableShelfDrillingRef.current = "No";
    setEditingFixedShelf("");
    setEditingAdjustableShelf("");
    setEditingFixedShelfDrilling("No");
    setEditingAdjustableShelfDrilling("No");
    setEditingInfoFocusLine(null);
  };

  const commitCellEdit = async (overrideValue?: string) => {
    if (!editingCell) return;
    if (isCommittingCutlistCellRef.current) return;
    isCommittingCutlistCellRef.current = true;
    try {
    const target = editingCell;
    const previousRow = cutlistRows.find((row) => row.id === target.rowId) ?? null;
    const rawValue = overrideValue ?? editingCellValue;
    const value = String(rawValue ?? "");
    const next = cutlistRows.map((row) => {
      if (row.id !== target.rowId) return row;
      const updated: CutlistRow = { ...row };
      switch (target.key) {
        case "board":
          updated.board = value;
          if (!boardGrainFor(String(updated.board ?? "").trim())) {
            updated.grainValue = "";
            updated.grain = false;
          }
          break;
        case "grain":
          if (!boardGrainFor(String(updated.board ?? "").trim())) {
            updated.grainValue = "";
            updated.grain = false;
            break;
          }
          updated.grainValue = String(value ?? "").trim();
          updated.grain = Boolean(updated.grainValue);
          break;
        case "clashing":
          if (isCabinetryPartType(updated.partType)) {
            updated.clashing = "";
            updated.clashLeft = "";
            updated.clashRight = "";
            updated.fixedShelf = String(editingFixedShelf ?? "").trim();
            updated.adjustableShelf = String(editingAdjustableShelf ?? "").trim();
            updated.fixedShelfDrilling = normalizeDrillingValue(editingFixedShelfDrilling);
            updated.adjustableShelfDrilling = normalizeDrillingValue(editingAdjustableShelfDrilling);
          } else {
            updated.clashing = joinClashing(editingClashLeft, editingClashRight).trim().toUpperCase().replace(/\b2SH\b/g, "2S");
            const split = splitClashing(updated.clashing);
            updated.clashLeft = split.left;
            updated.clashRight = split.right;
            updated.fixedShelf = "";
            updated.adjustableShelf = "";
            updated.fixedShelfDrilling = "No";
            updated.adjustableShelfDrilling = "No";
          }
          break;
        case "room":
          updated.room = value || "Project Cutlist";
          break;
        case "partType":
          updated.partType = value;
          if (isCabinetryPartType(value)) {
            updated.clashing = "";
            updated.clashLeft = "";
            updated.clashRight = "";
            updated.fixedShelfDrilling = normalizeDrillingValue(updated.fixedShelfDrilling);
            updated.adjustableShelfDrilling = normalizeDrillingValue(updated.adjustableShelfDrilling);
          } else {
            updated.fixedShelf = "";
            updated.adjustableShelf = "";
            updated.fixedShelfDrilling = "No";
            updated.adjustableShelfDrilling = "No";
            updated.clashing = joinClashing(String(updated.clashLeft ?? ""), String(updated.clashRight ?? ""));
          }
          if (isDrawerPartType(value)) {
            const tokens = parseDrawerHeightTokens(String(updated.height ?? ""));
            updated.height = formatDrawerHeightTokens(tokens);
            updated.quantity = String(Math.max(1, tokens.length));
          }
          break;
        case "height":
          if (isDrawerPartType(updated.partType)) {
            const tokens = parseDrawerHeightTokens(value);
            updated.height = formatDrawerHeightTokens(tokens);
            updated.quantity = String(Math.max(1, tokens.length));
          } else {
            updated.height = value;
          }
          break;
        default:
          updated[target.key] = value;
          break;
      }
      return updated;
    });
    const validationKeys = new Set<CutlistEditableField>(["partType", "board", "name", "height", "width", "depth", "quantity"]);
    if (validationKeys.has(target.key)) {
      const updatedRow = next.find((row) => row.id === target.rowId);
      if (updatedRow) {
        const issues = validateCutlistRowInput(updatedRow, String(updatedRow.partType || "").trim(), "Entry");
        const targetIssue = issues.find((issue) => issue.field === target.key);
        if (targetIssue) {
          const warnings = { [target.rowId]: { [target.key]: targetIssue.message } };
          setCutlistCellWarnings((prev) => ({
            ...prev,
            [target.rowId]: {
              ...(prev[target.rowId] || {}),
              [target.key]: targetIssue.message,
            },
          }));
          flashCutlistWarningCells(warnings);
          logCutlistValidationIssues([targetIssue], updatedRow.partType);
          return;
        }
        clearWarningForCell(target.rowId, target.key);
      }
    }
    const updatedRow = next.find((row) => row.id === target.rowId) ?? null;
    if (previousRow && updatedRow && target.key === "partType" && previousRow.partType !== updatedRow.partType) {
      const changedRowName = String(updatedRow.name || previousRow.name || "Unnamed Row").trim();
      logCutlistActivity(`${changedRowName} | Part Type:`, {
        partType: previousRow.partType,
        partTypeTo: updatedRow.partType,
      });
    }
    if (previousRow && updatedRow && target.key !== "partType") {
      const trackedKeys = new Set<CutlistEditableField>(["board", "name", "height", "width", "depth", "quantity", "clashing"]);
      if (trackedKeys.has(target.key)) {
        const before = cutlistValueForActivity(previousRow, target.key);
        const after = cutlistValueForActivity(updatedRow, target.key);
        if (before !== after) {
          const changedRowName = String(updatedRow.name || previousRow.name || "Unnamed Row").trim();
          logCutlistActivity(`${changedRowName} | ${cutlistFieldLabel(target.key)}:`, {
            partType: updatedRow.partType || previousRow.partType,
            valueFrom: before,
            valueTo: after,
            dedupeKey: `change:${updatedRow.id}:${target.key}:${before}->${after}`,
          });
        }
      }
    }
    setCutlistRows(next);
    setEditingCell(null);
    setEditingCellValue("");
    setEditingClashLeft("");
    setEditingClashRight("");
    editingFixedShelfRef.current = "";
    editingAdjustableShelfRef.current = "";
    editingFixedShelfDrillingRef.current = "No";
    editingAdjustableShelfDrillingRef.current = "No";
    setEditingFixedShelf("");
    setEditingAdjustableShelf("");
    setEditingFixedShelfDrilling("No");
    setEditingAdjustableShelfDrilling("No");
    setEditingInfoFocusLine(null);
    await persistCutlistRows(next);
    } finally {
      isCommittingCutlistCellRef.current = false;
    }
  };

  const isEditing = (rowId: string, key: CutlistEditableField) =>
    editingCell?.rowId === rowId && editingCell.key === key;

  const onInformationInputBlur = () => {
    window.setTimeout(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (!editingCell || editingCell.key !== "information") return;
      if (activeElement?.dataset?.cutlistInfoEditRow === editingCell.rowId) return;
      void commitCellEdit();
    }, 0);
  };

  const onCabinetryShelfInputBlur = (event: ReactFocusEvent<HTMLInputElement>, rowId: string) => {
    const editorRoot = event.currentTarget.closest(`[data-cutlist-cabinetry-edit="${rowId}"]`);
    window.setTimeout(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (!editingCell || editingCell.rowId !== rowId || editingCell.key !== "clashing") return;
      if (editorRoot && activeElement && editorRoot.contains(activeElement)) return;
      void commitCellEdit();
    }, 0);
  };

  useEffect(() => {
    editingFixedShelfRef.current = editingFixedShelf;
  }, [editingFixedShelf]);

  useEffect(() => {
    editingAdjustableShelfRef.current = editingAdjustableShelf;
  }, [editingAdjustableShelf]);

  useEffect(() => {
    editingFixedShelfDrillingRef.current = editingFixedShelfDrilling;
  }, [editingFixedShelfDrilling]);

  useEffect(() => {
    editingAdjustableShelfDrillingRef.current = editingAdjustableShelfDrilling;
  }, [editingAdjustableShelfDrilling]);

  const jumpToCutlistFromDerivedRowId = (rowId: string) => {
    const parsed = parseDerivedNestingRowId(rowId);
    const parent = cutlistRows.find((r) => r.id === parsed.parentRowId);
    if (!parent) return;

    setCutlistPartTypeFilter("All Part Types");
    setCutlistRoomFilter("Project Cutlist");
    setCollapsedCutlistGroups((prev) => ({ ...prev, [parent.partType]: false }));
    if (parsed.kind === "cab") {
      setExpandedCabinetryRows((prev) => ({ ...prev, [parent.id]: true }));
    } else if (parsed.kind === "drw") {
      setExpandedDrawerRows((prev) => ({ ...prev, [parent.id]: true }));
    }
    setCutlistJumpTarget(parsed);
    setProductionNav("cutlist");
    setNestingFullscreen(false);
    setNestingSheetPreview(null);
    setNestingPreviewHoverPieceId(null);
    setNestingTooltip(null);
  };

  const cutlistFullscreenNow = resolvedTab === "production" && productionAccess.view && productionNav === "cutlist";

  useEffect(() => {
    if (!cutlistJumpTarget || !cutlistFullscreenNow) return;
    const { parentRowId, kind, subKey } = cutlistJumpTarget;

    const run = () => {
      const selector =
        kind === "cab" || kind === "drw"
          ? `[data-cutlist-subrow-parent="${parentRowId}"][data-cutlist-subrow-key="${subKey}"]`
          : `[data-cutlist-row-id="${parentRowId}"]`;
      const target =
        (document.querySelector(selector) as HTMLElement | null) ??
        (document.querySelector(`[data-cutlist-row-id="${parentRowId}"]`) as HTMLElement | null);
      if (!target) return false;

      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("ring-2", "ring-[#3B82F6]");
      window.setTimeout(() => target.classList.remove("ring-2", "ring-[#3B82F6]"), 1400);
      return true;
    };

    const t0 = window.setTimeout(() => {
      if (run()) setCutlistJumpTarget(null);
    }, 40);
    const t1 = window.setTimeout(() => {
      if (run()) setCutlistJumpTarget(null);
    }, 180);
    const t2 = window.setTimeout(() => {
      if (run()) setCutlistJumpTarget(null);
    }, 360);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [cutlistJumpTarget, cutlistFullscreenNow]);

  const isCutlistFullscreen = resolvedTab === "production" && productionAccess.view && productionNav === "cutlist";
  const isCncFullscreen = resolvedTab === "production" && productionAccess.view && productionNav === "cnc";
  const isOrderFullscreen = resolvedTab === "production" && productionAccess.view && productionNav === "order";
  const isSalesInitialFullscreen = resolvedTab === "sales" && salesAccess.view && salesNav === "initial";
  const isNestingFullscreen =
    resolvedTab === "production" && productionAccess.view && productionNav === "nesting";
  const addRoomModalPortal =
    isAddRoomModalOpen && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 flex items-center justify-center px-4 py-4" style={{ zIndex: 2147483647 }}>
            <button
              type="button"
              aria-label="Close add room dialog backdrop"
              onClick={() => {
                setIsAddRoomModalOpen(false);
                setAddRoomName("");
              }}
              className="absolute inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-[2px]"
            />
            <div className="relative w-[min(720px,96vw)] overflow-hidden rounded-[14px] border border-[#D6DEE9] bg-white shadow-[0_28px_70px_rgba(2,6,23,0.28)]" style={{ zIndex: 2147483647 }}>
              <div className="border-b border-[#D7DEE8] px-5 py-4">
                <p className="text-[14px] font-bold uppercase tracking-[1px] text-[#12345B]">Add Room</p>
              </div>
              <div className="space-y-4 px-5 py-4">
                <div className="space-y-2">
                  <p className="text-[12px] font-semibold text-[#475467]">Room Name</p>
                  <input
                    autoFocus
                    value={addRoomName}
                    onChange={(e) => setAddRoomName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void onConfirmAddCutlistRoom();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setIsAddRoomModalOpen(false);
                        setAddRoomName("");
                      }
                    }}
                    placeholder="Enter room name"
                    className="h-10 w-full rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFC] px-3 text-[13px] text-[#111827] outline-none"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddRoomModalOpen(false);
                      setAddRoomName("");
                    }}
                    className="h-9 rounded-[9px] border border-[#D8DEE8] bg-white px-4 text-[12px] font-bold text-[#334155]"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={isSavingSalesRooms}
                    onClick={() => void onConfirmAddCutlistRoom()}
                    className="h-9 rounded-[9px] border border-[#BFE8CF] bg-[#DDF2E7] px-4 text-[12px] font-bold text-[#1F6A3B] disabled:opacity-55"
                  >
                    Add Room
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;
  useEffect(() => {
    if (!cncExportMenuOpen) return;
    const onDocPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (cncExportMenuRef.current?.contains(target)) return;
      setCncExportMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
    };
  }, [cncExportMenuOpen]);

  const companyThemeColor =
    normalizeHexColor(
      String(
        companyDoc?.themeColor ??
          ((companyDoc?.applicationPreferences as Record<string, unknown> | undefined)?.themeColor ?? ""),
      ),
    ) ?? "#2F6BFF";
  const cncHeaderTextColor = isLightHex(companyThemeColor) ? "#0F172A" : "#FFFFFF";
  const showCncGrainColumn =
    showCutlistGrainColumn || filteredCncRows.some((row) => String(row.grainValue ?? "").trim().length > 0);
  const cncTotalQty = filteredCncRows.reduce((sum, row) => sum + (Number.parseInt(String(row.quantity || "0"), 10) || 0), 0);
  const enabledQuoteContainers = useMemo(
    () =>
      quoteLayoutTemplate.containers.filter((container) => {
        if (!container.enabled) return false;
        if (hiddenQuoteContainerIdSet.has(String(container.id || "").trim())) return false;
        return container.columns.some((column) =>
          column.blocks.some(
            (block) =>
              block.enabled &&
              !hiddenQuoteBlockIdSet.has(String(block.id || "").trim()) &&
              quoteBlockCountsAsContent(block),
          ),
        );
      }),
    [hiddenQuoteBlockIdSet, hiddenQuoteContainerIdSet, quoteLayoutTemplate.containers],
  );
  const quotePreviewPaper = useMemo(
    () => quotePaperDimensionsFor(quoteLayoutTemplate.pageSize),
    [quoteLayoutTemplate.pageSize],
  );
  const topQuoteContainers = useMemo(
    () => enabledQuoteContainers.filter((container) => container.mount === "top"),
    [enabledQuoteContainers],
  );
  const flowQuoteContainers = useMemo(
    () => enabledQuoteContainers.filter((container) => container.mount === "flow"),
    [enabledQuoteContainers],
  );
  const bottomQuoteContainers = useMemo(
    () => enabledQuoteContainers.filter((container) => container.mount === "bottom"),
    [enabledQuoteContainers],
  );
  const paginatedQuoteProjectTextTarget = useMemo(() => {
    for (let i = 0; i < flowQuoteContainers.length; i += 1) {
      const container = flowQuoteContainers[i];
      for (const column of container.columns) {
        const block = column.blocks.find(
          (item) => item.enabled && !hiddenQuoteBlockIdSet.has(String(item.id || "").trim()) && item.type === "projectText",
        );
        if (block) {
          return { container, block, flowIndex: i };
        }
      }
    }
    return null;
  }, [flowQuoteContainers, hiddenQuoteBlockIdSet]);
  useEffect(() => {
    if (salesNav !== "quote") return;
    const sheet = quotePrintSheetRef.current;
    const inner = sheet?.querySelector(".quote-print-sheet-inner") as HTMLDivElement | null;
    if (!sheet || !inner) return;

    const pageHeight = inner.clientHeight;
    if (pageHeight <= 0) return;

    const orderedContainers = [...topQuoteContainers, ...flowQuoteContainers, ...bottomQuoteContainers];
    if (!orderedContainers.length) {
      setQuoteContainerPagination(null);
      setQuoteProjectTextPagination(null);
      setQuoteProjectTextMetrics(null);
      setQuoteProjectTextPreviewMode(null);
      return;
    }

    const gap = 16;
    const heights = orderedContainers.map((container) => ({
      id: container.id,
      height: quoteContainerRefs.current[container.id]?.offsetHeight ?? 0,
    }));
    if (heights.some((item) => item.height <= 0)) return;

    const totalHeight =
      heights.reduce((sum, item) => sum + item.height, 0) + Math.max(0, heights.length - 1) * gap;

    if (totalHeight <= pageHeight + 2) {
      setQuoteContainerPagination((prev) => (prev ? null : prev));
      setQuoteProjectTextPagination((prev) => (prev ? null : prev));
      setQuoteProjectTextMetrics(null);
      setQuoteProjectTextPreviewMode(null);
      return;
    }

    const pages: string[][] = [];
    let currentPage: string[] = [];
    let currentHeight = 0;
    heights.forEach(({ id, height }) => {
      const nextHeight = currentPage.length === 0 ? height : currentHeight + gap + height;
      if (currentPage.length > 0 && nextHeight > pageHeight + 2) {
        pages.push(currentPage);
        currentPage = [id];
        currentHeight = height;
      } else {
        currentPage.push(id);
        currentHeight = nextHeight;
      }
    });
    if (currentPage.length > 0) pages.push(currentPage);

    setQuoteContainerPagination((prev) => {
      if (prev && prev.pageContainerIds.length === pages.length && prev.pageContainerIds.every((pageIds, idx) => arraysEqualText(pageIds, pages[idx] ?? []))) {
        return prev;
      }
      return { pageContainerIds: pages };
    });
    setQuoteProjectTextPagination((prev) => (prev ? null : prev));
    setQuoteProjectTextMetrics(null);
    setQuoteProjectTextPreviewMode(null);
  }, [
    bottomQuoteContainers,
    flowQuoteContainers,
    quoteProjectTextDrafts,
    salesNav,
    salesQuoteProjectText,
    topQuoteContainers,
  ]);
  const quoteLayoutBoxStyle = (style: QuoteTemplateBoxStyle | undefined) => ({
    borderColor: toStr(style?.borderColor) || undefined,
    borderWidth: quoteSafePixelString(style?.borderWidthPx),
    borderStyle: toStr(style?.borderColor) || toStr(style?.borderWidthPx) ? "solid" : undefined,
    backgroundColor: toStr(style?.fillColor) || undefined,
    paddingTop: quoteSafePixelString(style?.paddingTopPx || style?.paddingPx),
    paddingBottom: quoteSafePixelString(style?.paddingBottomPx || style?.paddingPx),
    paddingLeft: quoteSafePixelString(style?.paddingLeftPx || style?.paddingPx),
    paddingRight: quoteSafePixelString(style?.paddingRightPx || style?.paddingPx),
    margin: quoteSafePixelString(style?.marginPx),
  });
  const quotePrintMarginMm = Math.max(10, Number(quoteLayoutTemplate.marginMm || 12));
  const quotePreviewWidthCss = "min(100%, 860px)";
  const quotePreviewMarginScale = quotePrintMarginMm / Math.max(1, quotePreviewPaper.widthMm);
  const quotePreviewPaddingCss = `calc(${quotePreviewWidthCss} * ${quotePreviewMarginScale})`;
  const onPrintSalesQuote = () => {
    if (typeof window === "undefined" || !quotePrintSheetRef.current) return;
    window.print();
  };
  if (isLoading) {
    return (
      <ProtectedRoute>
        <AppShell>
          <Card>
            <CardContent className="pt-5 text-sm text-[#475467]">Loading project...</CardContent>
          </Card>
        </AppShell>
      </ProtectedRoute>
    );
  }

  if (!project) {
    return (
      <ProtectedRoute>
        <AppShell>
          <Card>
            <CardContent className="pt-5 text-sm text-[#475467]">Project not found.</CardContent>
          </Card>
        </AppShell>
      </ProtectedRoute>
    );
  }

  const roomTags = salesRoomRows.map((row) => row.name);
  const quoteCompanyName = toStr(
    companyDoc?.companyName ??
      companyDoc?.name ??
      ((companyDoc?.applicationPreferences as Record<string, unknown> | undefined)?.companyName ?? ""),
    "Company",
  );
  const quoteCompanyLogoPath = toStr(
    companyDoc?.logoPath ??
      ((companyDoc?.theme as Record<string, unknown> | undefined)?.logoPath ?? ""),
  );
  const renderQuoteTemplateBlock = (
    block: QuoteTemplateBlock,
    keyPrefix: string,
    options?: {
      projectTextValueOverride?: string;
      projectTextChunkIndex?: number;
      projectTextChunkCount?: number;
      thumbnailMode?: boolean;
    },
  ) => {
      if (!block.enabled) return null;
      if (hiddenQuoteBlockIdSet.has(String(block.id || "").trim())) return null;
      if (block.type === "divider") {
        return <div key={`${keyPrefix}_${block.id}`} className="my-1 h-px w-full bg-[#CBD5E1]" />;
      }
    if (block.type === "spacer") {
      const height = Math.max(6, Math.min(40, Number(block.heightMm || 12)));
      return <div key={`${keyPrefix}_${block.id}`} style={{ height: `${height}px` }} />;
    }
      if (block.type === "logo") {
        return (
          <div key={`${keyPrefix}_${block.id}`} className="flex h-[84px] items-center justify-center bg-transparent text-[12px] font-semibold text-[#52637A]">
            {quoteCompanyLogoPath ? (
              <img
                src={quoteCompanyLogoPath}
                alt={quoteCompanyName}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              quoteCompanyName ? `${quoteCompanyName} Logo` : "Company Logo"
            )}
          </div>
        );
      }
      if (block.type === "projectText") {
        const fullValue = Object.prototype.hasOwnProperty.call(quoteProjectTextDrafts, block.id)
          ? quoteProjectTextDrafts[block.id] ?? ""
          : salesQuoteProjectText[block.id] ?? "";
        const value = options?.projectTextValueOverride ?? fullValue;
        const chunkIndex = options?.projectTextChunkIndex ?? 0;
        const chunkCount = options?.projectTextChunkCount ?? 1;
        const isContinuationChunk = chunkCount > 1 && chunkIndex > 0;
        if (isContinuationChunk || options?.thumbnailMode) {
          return (
            <div key={`${keyPrefix}_${block.id}`} className="py-3">
              <div
                className="text-[12px] leading-[1.5]"
                style={{ color: toStr(block.textColor) || undefined, whiteSpace: "pre-wrap" }}
                dangerouslySetInnerHTML={{
                  __html: renderQuoteRichTextHtml(interpolateQuoteTemplateText(value, effectiveQuoteTemplateReplacements)),
                }}
              />
            </div>
          );
        }
        return (
          <div key={`${keyPrefix}_${block.id}`} className="py-3">
            <div
              ref={(node) => {
                if (chunkIndex === 0) quoteProjectTextToolbarRefs.current[block.id] = node;
              }}
              className={`quote-project-text-toolbar mb-2 flex items-center gap-1 print:hidden ${chunkIndex > 0 ? "hidden" : ""}`}
            >
              {[
                { command: "bold" as const, label: "B" },
                { command: "italic" as const, label: "I" },
                { command: "underline" as const, label: "U" },
                { command: "strikeThrough" as const, label: "S" },
              ].map((item) => (
                <button
                  key={`${block.id}_${item.command}`}
                  type="button"
                  disabled={salesReadOnly || isSavingQuoteProjectText}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyQuoteRichTextCommand(
                      quoteProjectTextRefs.current[block.id] ?? null,
                      item.command,
                      (nextValue) => setQuoteProjectTextDrafts((prev) => ({ ...prev, [block.id]: nextValue })),
                    );
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#F8FAFD] text-[12px] font-bold text-[#344054] disabled:opacity-60"
                  title={item.label}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div
              ref={(node) => {
                if (chunkIndex === 0) quoteProjectTextRefs.current[block.id] = node;
                if (node) {
                  const nextHtml = renderQuoteRichTextHtml(value);
                  if (document.activeElement !== node && node.innerHTML !== nextHtml) {
                    node.innerHTML = nextHtml;
                  }
                }
              }}
              contentEditable={!salesReadOnly && !isSavingQuoteProjectText}
              suppressContentEditableWarning
              onInput={(e) => {
                const nextValue = sanitizeQuoteRichTextMarkup(e.currentTarget.innerHTML);
                if (chunkCount > 1 && quoteProjectTextPagination?.blockId === block.id) {
                  const nextChunks = [...quoteProjectTextPagination.chunks];
                  nextChunks[chunkIndex] = nextValue;
                  setQuoteProjectTextDrafts((prev) => ({ ...prev, [block.id]: nextChunks.join("\n") }));
                } else {
                  setQuoteProjectTextDrafts((prev) => ({ ...prev, [block.id]: nextValue }));
                }
              }}
              onFocus={() => {
                setActiveQuoteProjectTextEditBlockId(block.id);
              }}
              onBlur={() => {
                setActiveQuoteProjectTextEditBlockId((prev) => (prev === block.id ? null : prev));
                void persistQuoteProjectText(block.id, String(quoteProjectTextDrafts[block.id] ?? fullValue ?? ""));
              }}
              className="min-h-[24px] w-full border-0 bg-transparent px-0 py-0 text-[12px] leading-[1.5] outline-none empty:before:text-[#98A2B3] print:hidden"
              style={{ color: toStr(block.textColor) || undefined, whiteSpace: "pre-wrap" }}
            />
            <div
              className="hidden text-[12px] leading-[1.5] print:block"
              dangerouslySetInnerHTML={{
                __html: renderQuoteRichTextHtml(interpolateQuoteTemplateText(value, effectiveQuoteTemplateReplacements)),
              }}
            />
          </div>
        );
      }
      if (block.type === "companyDetails") {
        return (
          <div key={`${keyPrefix}_${block.id}`} className="space-y-1 text-[12px] text-[#0F172A]">
            <p className="font-semibold">{quoteCompanyName}</p>
            <p>Currency: {toStr(companyDoc?.defaultCurrency, "-")}</p>
            <p>Units: {toStr(companyDoc?.measurementUnit, "-")}</p>
          </div>
        );
      }
      if (block.type === "clientDetails") {
        return (
          <div key={`${keyPrefix}_${block.id}`} className="space-y-1 text-[12px] text-[#0F172A]">
            <p><span className="font-semibold">Name:</span> {toStr(project.customer, "-")}</p>
            <p><span className="font-semibold">Phone:</span> {toStr(project.clientPhone, "-")}</p>
            <p><span className="font-semibold">Email:</span> {toStr(project.clientEmail, "-")}</p>
            <p><span className="font-semibold">Address:</span> {toStr(project.clientAddress, "-")}</p>
          </div>
        );
      }
      if (block.type === "quoteMeta") {
        return (
          <div key={`${keyPrefix}_${block.id}`} className="space-y-1 text-[12px] text-[#0F172A]">
            <p className="text-[18px] font-semibold text-[#12345B]">{toStr(project.name, "Untitled Project")}</p>
            <p><span className="font-semibold">Client:</span> {toStr(project.customer, "-")}</p>
            <p><span className="font-semibold">Date:</span> {dashboardStyleDate(new Date().toISOString())}</p>
            <p><span className="font-semibold">Prepared by:</span> {toStr(project.createdByName, "-")}</p>
          </div>
        );
      }
      if (block.type === "roomBreakdown") {
        return (
          <div key={`${keyPrefix}_${block.id}`} className="space-y-2">
            <div className="grid grid-cols-[1fr_120px] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.8px] text-[#475467]">
              <p>Room</p>
              <p className="text-right">Price</p>
            </div>
            {includedSalesRoomsForQuote.length > 0 ? (
              includedSalesRoomsForQuote.map((room) => (
                <div key={`${keyPrefix}_${block.id}_${room.name}`} className="grid grid-cols-[1fr_120px] px-3 py-2 text-[12px] text-[#0F172A]">
                  <p className="font-medium">{room.name}</p>
                  <p className="text-right font-semibold">{room.totalPrice}</p>
                </div>
              ))
            ) : (
              <div className="px-3 py-3 text-[12px] text-[#667085]">No included rooms yet.</div>
            )}
          </div>
        );
      }
      if (block.type === "totals") {
        return (
          <div key={`${keyPrefix}_${block.id}`} className="space-y-2 px-3 py-3">
            <div className="flex items-center justify-between text-[12px] text-[#0F172A]">
              <span>Included Rooms</span>
              <span className="font-semibold">{includedSalesRoomsForQuote.length}</span>
            </div>
            <div className="flex items-center justify-between border-t border-[#D7DEE8] pt-2 text-[14px] font-semibold text-[#12345B]">
              <span>Total</span>
              <span>{formatCurrencyValue(displayedSalesQuoteFinalTotal)}</span>
            </div>
          </div>
        );
      }
      const interpolated = interpolateQuoteTemplateText(block.content, effectiveQuoteTemplateReplacements);
      return (
        <div
          key={`${keyPrefix}_${block.id}`}
          className="text-[12px] leading-[1.45]"
          dangerouslySetInnerHTML={{ __html: renderQuoteRichTextHtml(interpolated) }}
        />
      );
    };
  const renderQuoteContainer = (
    container: QuoteTemplateContainer,
    keyPrefix: string,
    options?: {
      projectTextBlockId?: string;
      projectTextValueOverride?: string;
      projectTextChunkIndex?: number;
      projectTextChunkCount?: number;
      attachRef?: boolean;
      thumbnailMode?: boolean;
    },
  ) => (
    <div
      key={`${keyPrefix}_${container.id}`}
      ref={options?.attachRef ? (node) => { quoteContainerRefs.current[container.id] = node; } : undefined}
      className="space-y-3"
      style={{ minHeight: "20px", ...quoteLayoutBoxStyle(container.style) }}
      data-quote-container-id={container.id}
    >
      <div className="flex flex-wrap">
        {container.columns.map((column) => (
          <div
            key={`quote_col_${keyPrefix}_${container.id}_${column.id}`}
            className="space-y-0"
            style={{
              flex: `0 0 ${quoteColumnWidthPercent(column.span)}%`,
              maxWidth: `${quoteColumnWidthPercent(column.span)}%`,
              ...quoteLayoutBoxStyle(column.style),
            }}
          >
            {column.blocks.map((block) =>
              renderQuoteTemplateBlock(block, `col_${keyPrefix}_${container.id}_${column.id}`, {
                projectTextValueOverride:
                  options?.projectTextBlockId === block.id ? options.projectTextValueOverride : undefined,
                projectTextChunkIndex:
                  options?.projectTextBlockId === block.id ? options.projectTextChunkIndex : undefined,
                projectTextChunkCount:
                  options?.projectTextBlockId === block.id ? options.projectTextChunkCount : undefined,
                thumbnailMode: options?.thumbnailMode,
              }),
            )}
          </div>
        ))}
      </div>
    </div>
  );
  const quotePreviewPages = (() => {
    const containerById = new Map(enabledQuoteContainers.map((container) => [container.id, container] as const));
    if (!quoteContainerPagination || quoteContainerPagination.pageContainerIds.length <= 1) {
      return [
        {
          id: "quote_page_1",
          containers: [...topQuoteContainers, ...flowQuoteContainers],
          bottomContainers: bottomQuoteContainers,
          pinBottomToPage: true,
        },
      ];
    }
    return quoteContainerPagination.pageContainerIds.map((pageIds, idx) => ({
      id: `quote_page_${idx + 1}`,
      containers: pageIds.map((id) => containerById.get(id)).filter(Boolean) as QuoteTemplateContainer[],
      bottomContainers: [] as QuoteTemplateContainer[],
      pinBottomToPage: false,
    }));
  })();
  const onQuotePreviewScroll = () => {
    const scroller = quotePreviewScrollRef.current;
    if (!scroller || quotePreviewPages.length <= 1) return;
    const top = scroller.scrollTop;
    let bestId = quotePreviewPages[0]?.id || "quote_page_1";
    let bestDistance = Number.POSITIVE_INFINITY;
    quotePreviewPages.forEach((page) => {
      const node = quotePreviewPageRefs.current[page.id];
      if (!node) return;
      const distance = Math.abs(node.offsetTop - top);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = page.id;
      }
    });
    setActiveQuotePreviewPageId((prev) => (prev === bestId ? prev : bestId));
  };
  const jumpToQuotePreviewPage = (pageId: string) => {
    const node = quotePreviewPageRefs.current[pageId];
    if (!node) return;
    setActiveQuotePreviewPageId(pageId);
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const renderQuotePreviewPageBody = (
    page: (typeof quotePreviewPages)[number],
    keyPrefix: string,
    options?: { attachRef?: boolean; thumbnailMode?: boolean },
  ) => (
    <div className="quote-print-sheet-inner flex h-full min-h-0 flex-col">
      <div className="space-y-4">
        {page.containers.map((container, containerIndex) =>
          renderQuoteContainer(container, `${keyPrefix}_container_${containerIndex}`, {
            attachRef: options?.attachRef,
            thumbnailMode: options?.thumbnailMode,
          }),
        )}
      </div>
      {page.bottomContainers.length > 0 && (
        <div className={`${page.pinBottomToPage ? "mt-auto" : ""} space-y-4 pt-4`}>
          {page.bottomContainers.map((container, containerIndex) =>
            renderQuoteContainer(container, `${keyPrefix}_bottom_${containerIndex}`, {
              attachRef: options?.attachRef,
              thumbnailMode: options?.thumbnailMode,
            }),
          )}
        </div>
      )}
    </div>
  );
  const salesQuotePreviewContent = (
    <div className="quote-preview-shell">
      <section className="quote-preview-stage rounded-[18px] border border-[#D7DEE8] bg-[#EDEFF4] p-4 shadow-[inset_0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="space-y-4">
          {quotePreviewPages.map((page, pageIndex) => (
            <div
              key={page.id}
              ref={(node) => {
                quotePreviewPageRefs.current[page.id] = node;
                if (pageIndex === 0) quotePrintSheetRef.current = node;
              }}
              data-quote-print-sheet="true"
              className="quote-print-sheet mx-auto flex flex-col rounded-[18px] border border-[#D7DEE8] bg-white shadow-[0_18px_36px_rgba(15,23,42,0.08)]"
              style={{
                width: quotePreviewWidthCss,
                aspectRatio: `${quotePreviewPaper.widthMm} / ${quotePreviewPaper.heightMm}`,
                padding: quotePreviewPaddingCss,
              }}
            >
              {renderQuotePreviewPageBody(page, page.id, { attachRef: true })}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
  const salesQuoteExtrasSidebar = (
    <aside className="quote-extras-live-panel w-full shrink-0 self-start rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)] lg:sticky lg:top-[72px] lg:max-h-[calc(100dvh-96px)] lg:w-[280px] lg:overflow-auto">
      <div className="flex h-[50px] items-center border-b border-[#D7DEE8] px-4">
        <p className="text-[14px] font-medium tracking-[1px] text-[#0F2A4A]">QUOTE EXTRAS</p>
      </div>
      <div className="space-y-4 p-4 text-[12px]">
        {displayedSalesQuoteExtras.length > 0 ? (
          <div className="space-y-2">
            {displayedSalesQuoteExtras.map((item) => (
              <label key={`quote_preview_extra_${item.id}`} className="flex items-center gap-2 text-[#1F2937]">
                <input
                  type="checkbox"
                  checked={item.included}
                  disabled={salesReadOnly || isSavingSalesRooms}
                  onChange={(e) => void onToggleSalesQuoteExtraIncluded(item, e.target.checked)}
                  className="h-[12px] w-[12px]"
                />
                <span className="font-semibold">{item.name}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-[#667085]">No quote extras configured.</p>
        )}
        <div className="border-t border-[#E5E7EB] pt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium tracking-[1px] text-[#0F2A4A]">QUOTE HELPERS</p>
            {!activeQuoteProjectTextEditBlockId ? (
              <span className="text-[10px] font-semibold uppercase tracking-[0.8px] text-[#98A2B3]">Select text field</span>
            ) : null}
          </div>
          {salesQuoteHelpers.length > 0 ? (
            <div className="space-y-2">
              {salesQuoteHelpers.map((helper) => (
                <button
                  key={`quote_helper_${helper.id}`}
                  type="button"
                  disabled={!activeQuoteProjectTextEditBlockId || salesReadOnly || isSavingQuoteProjectText}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertSalesQuoteHelperAtCursor(helper);
                  }}
                  className="w-full rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFD] px-3 py-2 text-left transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div
                    className="text-[12px] leading-[1.45] text-[#1F2937]"
                    dangerouslySetInnerHTML={{ __html: renderQuoteRichTextHtml(helper.content) }}
                  />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-[#667085]">No quote helpers configured.</p>
          )}
        </div>
      </div>
    </aside>
  );
  const salesQuoteFullscreenPortal =
    resolvedTab === "sales" && salesAccess.view && salesNav === "quote" && typeof document !== "undefined"
      ? createPortal(
          <div className="quote-print-root fixed inset-0 z-[2147483640] flex min-h-0 flex-col overflow-hidden bg-[var(--bg-app)]">
            <style>{`
              @media print {
                @page {
                  size: ${quotePreviewPaper.widthMm}mm ${quotePreviewPaper.heightMm}mm;
                  margin: 0;
                }
                html, body {
                  margin: 0 !important;
                  padding: 0 !important;
                  background: #ffffff !important;
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
                body > * {
                  display: none !important;
                }
                .quote-print-root {
                  display: block !important;
                  position: static !important;
                  inset: auto !important;
                  overflow: visible !important;
                  min-height: 0 !important;
                  background: #ffffff !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                  color-adjust: exact !important;
                  forced-color-adjust: none !important;
                }
                .quote-print-root,
                .quote-print-root * {
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                  color-adjust: exact !important;
                  forced-color-adjust: none !important;
                }
                .quote-print-content {
                  overflow: visible !important;
                  padding: 0 !important;
                }
                .quote-print-content-shell {
                  max-width: none !important;
                  width: ${quotePreviewPaper.widthMm}mm !important;
                  margin: 0 auto !important;
                }
                .quote-extras-live-panel {
                  display: none !important;
                }
                .quote-preview-shell {
                  margin: 0 !important;
                }
                .quote-preview-shell > :not(.quote-preview-stage) {
                  display: none !important;
                }
                .quote-print-chrome,
                .quote-preview-meta {
                  display: none !important;
                }
                .quote-preview-stage {
                  display: block !important;
                  border: none !important;
                  background: transparent !important;
                  box-shadow: none !important;
                  margin: 0 !important;
                  padding: 0 !important;
                }
                .quote-print-sheet {
                  width: ${quotePreviewPaper.widthMm}mm !important;
                  min-height: 0 !important;
                  height: ${quotePreviewPaper.heightMm}mm !important;
                  margin: 0 !important;
                  border: none !important;
                  box-shadow: none !important;
                  border-radius: 0 !important;
                  background: #ffffff !important;
                  aspect-ratio: auto !important;
                  padding: ${quotePrintMarginMm}mm !important;
                  box-sizing: border-box !important;
                }
                .quote-print-sheet-inner {
                  min-height: 100% !important;
                  height: 100% !important;
                }
                .quote-print-sheet * {
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
                .quote-print-sheet [style*="background"] {
                  background-clip: padding-box !important;
                }
                .quote-print-sheet [style*="background-color"] {
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                  color-adjust: exact !important;
                  forced-color-adjust: none !important;
                }
                .quote-print-sheet [style*="border-color"] {
                  border-style: solid !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                  color-adjust: exact !important;
                  forced-color-adjust: none !important;
                }
              }
            `}</style>
            <div className="quote-print-chrome sticky top-0 z-[95] flex h-[56px] shrink-0 items-center justify-between border-b border-[#D7DEE8] bg-white px-4 md:px-5">
              <div className="inline-flex items-center gap-2 text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">
                <Quote size={14} />
                <span>Quote</span>
                <span className="text-[#6B7280]">|</span>
                <span className="truncate text-[#334155]">{project?.name || "Project"}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onPrintSalesQuote}
                  className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFD] px-3 text-[12px] font-bold text-[#475467] hover:bg-[#EEF2F7]"
                >
                  <Printer size={14} />
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => setSalesNav("items")}
                  className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#C8DAFF] bg-[#EAF1FF] px-3 text-[12px] font-bold text-[#24589A] hover:bg-[#DFE9FF]"
                >
                  <ArrowLeft size={14} />
                  Save & Back
                </button>
              </div>
            </div>
            <div
              ref={quotePreviewScrollRef}
              onScroll={onQuotePreviewScroll}
              className="quote-print-content min-h-0 flex-1 overflow-auto px-4 py-4 md:px-5"
            >
              <div className="quote-print-content-shell mx-auto flex w-full max-w-[1440px] flex-col gap-4 lg:flex-row lg:items-start">
                {quotePreviewPages.length > 1 ? (
                  <aside className="hidden lg:sticky lg:top-[72px] lg:flex lg:w-[120px] lg:shrink-0 lg:flex-col lg:gap-3">
                    {quotePreviewPages.map((page, index) => {
                      const isActive = activeQuotePreviewPageId === page.id;
                      return (
                        <button
                          key={`quote_thumb_${page.id}`}
                          type="button"
                          onClick={() => jumpToQuotePreviewPage(page.id)}
                          className={`group flex flex-col items-center gap-2 rounded-[12px] border px-3 py-3 text-left transition ${
                            isActive
                              ? "border-[#8FB4FF] bg-[#EAF1FF] shadow-[0_8px_20px_rgba(47,107,255,0.12)]"
                              : "border-[#D7DEE8] bg-white hover:border-[#B9C7DA] hover:bg-[#F8FAFD]"
                          }`}
                        >
                          <div
                            className="relative w-full overflow-hidden rounded-[6px] border border-[#D7DEE8] bg-white shadow-[0_6px_14px_rgba(15,23,42,0.08)]"
                            style={{
                              aspectRatio: `${quotePreviewPaper.widthMm} / ${quotePreviewPaper.heightMm}`,
                            }}
                          >
                            <div
                              className="absolute left-0 top-0 origin-top-left"
                              style={{
                                width: "625%",
                                height: "625%",
                                transform: "scale(0.16)",
                                transformOrigin: "top left",
                                padding: quotePreviewPaddingCss,
                                boxSizing: "border-box",
                                background: "#ffffff",
                              }}
                            >
                              {renderQuotePreviewPageBody(page, `thumb_${page.id}`, { thumbnailMode: true })}
                            </div>
                          </div>
                          <span className={`text-[11px] font-bold ${isActive ? "text-[#24589A]" : "text-[#475467]"}`}>
                            Page {index + 1}
                          </span>
                        </button>
                      );
                    })}
                  </aside>
                ) : null}
                <div className="min-w-0 flex-1">
                  {salesQuotePreviewContent}
                </div>
                {salesQuoteExtrasSidebar}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  const permissionRows = [
    {
      uid: user?.uid ?? "current",
      displayName: user?.displayName || project.createdByName || "Current User",
      role: effectiveRole,
    },
    ...unlockMembers.map((member) => ({
      uid: member.uid,
      displayName: member.displayName,
      role: member.role,
    })),
  ]
    .slice(0, 8)
    .map((row) => {
      const isCreatorUser =
        String(project.createdByUid ?? "").trim() !== "" &&
        String(row.uid || "").trim() === String(project.createdByUid ?? "").trim();
      const isAssignedUser =
        String(project.assignedToUid ?? "").trim() !== "" &&
        String(row.uid || "").trim() === String(project.assignedToUid ?? "").trim();
      const accessLabel = isCreatorUser || isAssignedUser ? "Edit" : "No Access";
      return {
        ...row,
        accessLabel,
      };
    });

  const selectedNestingSheet = (() => {
    if (!nestingSheetPreview) return null;
    const group = nestingBoardLayouts.find((g) => g.boardKey === nestingSheetPreview.boardKey);
    if (!group) return null;
    const sheet = group.sheets.find((s) => s.index === nestingSheetPreview.sheetIndex);
    if (!sheet) return null;
    return { group, sheet };
  })();
  const selectedNestingSheetRatio = selectedNestingSheet
    ? Math.max(0.1, selectedNestingSheet.group.sheetWidth / selectedNestingSheet.group.sheetHeight)
    : 1;
  const selectedNestingSheetViewportWidth = selectedNestingSheet
    ? `min(calc(54vw - 80px), calc((100dvh - 440px) * ${selectedNestingSheetRatio}))`
    : "min(54vw, 760px)";
  const selectedNestingSheetViewportHeight = selectedNestingSheet
    ? `min(calc((54vw - 80px) / ${selectedNestingSheetRatio}), calc(100dvh - 440px))`
    : "min(48vh, 420px)";
  const selectedNestingSheetStats = (() => {
    if (!selectedNestingSheet) return null;
    const sheetAreaMm2 = Math.max(1, selectedNestingSheet.group.sheetWidth * selectedNestingSheet.group.sheetHeight);
    const usedAreaMm2 = selectedNestingSheet.sheet.placements.reduce((sum, p) => sum + Math.max(0, p.w * p.h), 0);
    const usedPct = Math.max(0, Math.min(100, (usedAreaMm2 / sheetAreaMm2) * 100));
    const wastagePct = Math.max(0, 100 - usedPct);
    const largest = selectedNestingSheet.sheet.placements.reduce((best, p) => {
      if (!best) return p;
      return p.w * p.h > best.w * best.h ? p : best;
    }, null as (typeof selectedNestingSheet.sheet.placements)[number] | null);
    return {
      usedPct,
      wastagePct,
      partCount: selectedNestingSheet.sheet.placements.length,
      sheetAreaM2: sheetAreaMm2 / 1_000_000,
      largest,
    };
  })();
  const orderBoardSummary = productionForm.boardTypes
    .map((row) => {
      const sheetsRequired = Math.max(0, requiredSheetCountByBoardRowId[row.id] ?? 0);
      const boardLabel = boardDisplayLabel(row.colour) || "Unassigned";
      const boardSize = row.sheetSize || boardSizeFor(row.colour) || "-";
      const thickness = row.thickness ? `${row.thickness} mm` : "-";
      const finish = row.finish || "-";
      const hasAnyValue =
        String(row.colour || "").trim().length > 0 ||
        String(row.thickness || "").trim().length > 0 ||
        String(row.finish || "").trim().length > 0 ||
        String(row.sheetSize || "").trim().length > 0 ||
        sheetsRequired > 0;
      return {
        id: row.id,
        boardLabel,
        boardSize,
        thickness,
        finish,
        sheetsRequired,
        hasAnyValue,
      };
    })
    .filter((row) => row.hasAnyValue);
  const orderTotalSheetsRequired = orderBoardSummary.reduce((sum, row) => sum + row.sheetsRequired, 0);
  const orderDrawerRows = cutlistRows.filter((row) => isDrawerPartType(row.partType));
  const orderDrawerQtyTotal = orderDrawerRows.reduce(
    (sum, row) => sum + Math.max(0, Number.parseInt(String(row.quantity || "0"), 10) || 0),
    0,
  );
  const orderDrawerGroupedRows = (() => {
    type Group = {
      key: string;
      hardware: string;
      drawerType: string;
      hardwareLength: string;
      backHeight: string;
      total: number;
    };
    const selectedCategory = String(productionForm.hardware.hardwareCategory || defaultHardwareCategory()).trim() || "Unassigned";
    const selectedDrawerType = String(productionForm.hardware.newDrawerType || "").trim() || "Unassigned";
    const groups: Record<string, Group> = {};

    for (const row of orderDrawerRows) {
      const qty = Math.max(0, Number.parseInt(String(row.quantity || "0"), 10) || 0);
      if (qty <= 0) continue;

      const depthVal = toNum(row.depth);
      let hardwareDepthLabel = "-";
      if (depthVal > 0) {
        let depthForHardware = depthVal;
        if (selectedDrawerBreakdown.spaceRequirement != null) {
          depthForHardware = Math.max(0, depthForHardware - selectedDrawerBreakdown.spaceRequirement);
        }
        let roundedHardwareDepth = depthForHardware;
        if (selectedDrawerBreakdown.hardwareLengths.length) {
          const candidates = selectedDrawerBreakdown.hardwareLengths.filter((v) => v <= depthForHardware);
          if (candidates.length) roundedHardwareDepth = Math.max(...candidates);
        }
        hardwareDepthLabel = formatMm(roundedHardwareDepth);
      }

      const rawHeight = String(row.height || "").trim();
      let tokens = parseDrawerHeightTokens(rawHeight);
      if (!tokens.length && rawHeight) tokens = [rawHeight];
      if (!tokens.length) tokens = ["-"];
      const groupedHeights: Record<string, number> = {};
      for (const token of tokens) {
        const tokenClean = sanitizeDerivedValue(token);
        const tokenWithCountMatch = tokenClean.match(/^(.*?)(?:\s*\(\s*x\s*(\d+)\s*\))$/i);
        const tokenBase = sanitizeDerivedValue(tokenWithCountMatch?.[1] ?? tokenClean);
        const tokenCount = Math.max(
          1,
          Number.parseInt(String(tokenWithCountMatch?.[2] ?? "1"), 10) || 1,
        );
        const displayHeight = tokenBase || "-";
        groupedHeights[displayHeight] = (groupedHeights[displayHeight] ?? 0) + tokenCount;
      }
      for (const [height, perDrawerQty] of Object.entries(groupedHeights)) {
        const groupKey = `${selectedCategory}|${selectedDrawerType}|${hardwareDepthLabel}|${height}`;
        if (!groups[groupKey]) {
          groups[groupKey] = {
            key: groupKey,
            hardware: selectedCategory,
            drawerType: selectedDrawerType,
            hardwareLength: hardwareDepthLabel,
            backHeight: height || "-",
            total: 0,
          };
        }
        groups[groupKey].total += perDrawerQty * qty;
      }
    }

    return Object.values(groups).sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        const byHardware = a.hardware.localeCompare(b.hardware);
        if (byHardware) return byHardware;
        const byType = a.drawerType.localeCompare(b.drawerType);
        if (byType) return byType;
        const byLength = a.hardwareLength.localeCompare(b.hardwareLength);
        if (byLength) return byLength;
        return a.backHeight.localeCompare(b.backHeight);
      });
  })();
  const orderSelectedHardwareCategoryKey = String(
    productionForm.hardware.hardwareCategory || defaultHardwareCategory(),
  )
    .trim()
    .toLowerCase();
  const orderSelectedHardwareRow = hardwareRows.find(
    (row) => row.name.toLowerCase() === orderSelectedHardwareCategoryKey,
  );
  const orderHingeOptions = orderSelectedHardwareRow?.hinges ?? [];
  const orderHingeRows = orderHingeRowsByCategory[orderSelectedHardwareCategoryKey] ?? [];
  const orderMiscDraftForCategory = orderMiscDraftByCategory[orderSelectedHardwareCategoryKey] ?? {};
  const orderMiscLines = (() => {
    type Line = { key: string; name: string; notes: string; qty: string };
    const names = orderSelectedHardwareRow?.other ?? [];
    const out: Line[] = [];
    const seen = new Set<string>();
    for (const raw of names) {
      const fallbackName = String(raw || "").trim();
      if (!fallbackName) continue;
      const key = fallbackName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const draft = orderMiscDraftForCategory[key];
      if (draft?.deleted) continue;
      out.push({
        key,
        name: String(draft?.name || "").trim(),
        notes: String(draft?.notes || "").trim(),
        qty: String(draft?.qty || "").trim(),
      });
    }
    for (const [keyRaw, draft] of Object.entries(orderMiscDraftForCategory)) {
      const key = String(keyRaw || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      if (draft?.deleted) continue;
      seen.add(key);
      out.push({
        key,
        name: String(draft?.name || "").trim(),
        notes: String(draft?.notes || "").trim(),
        qty: String(draft?.qty || "").trim(),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  })();
  const onAddOrderHingeRow = () => {
    setOrderHingeRowsByCategory((prev) => {
      const current = prev[orderSelectedHardwareCategoryKey] ?? [];
      return {
        ...prev,
        [orderSelectedHardwareCategoryKey]: [
          ...current,
          {
            id: `ord_hinge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            name: "",
            qty: "",
          },
        ],
      };
    });
  };

  const startInitialCellEdit = (row: CutlistRow, key: CutlistEditableField) => {
    if (key === "grain") {
      if (!initialMeasureBoardGrainFor(String(row.board ?? "").trim())) return;
      setInitialEditingCell({ rowId: row.id, key });
      setInitialEditingCellValue(String(row.grainValue ?? "").trim());
      return;
    }
    setInitialEditingCell({ rowId: row.id, key });
    if (key === "clashing") {
      setInitialEditingCellValue(joinClashing(String(row.clashLeft ?? ""), String(row.clashRight ?? "")));
      return;
    }
    setInitialEditingCellValue(String(row[key] ?? ""));
  };

  const cancelInitialCellEdit = () => {
    setInitialEditingCell(null);
    setInitialEditingCellValue("");
  };

  const commitInitialCellEdit = async (overrideValue?: string) => {
    if (!initialEditingCell) return;
    const target = initialEditingCell;
    const value = String(overrideValue ?? initialEditingCellValue ?? "");
    const previousRow = initialCutlistRows.find((row) => row.id === target.rowId) ?? null;
    const next = initialCutlistRows.map((row) => {
      if (row.id !== target.rowId) return row;
      const updated: CutlistRow = { ...row };
      switch (target.key) {
        case "board":
          updated.board = value;
          if (!initialMeasureBoardGrainFor(String(updated.board ?? "").trim())) {
            updated.grainValue = "";
            updated.grain = false;
          }
          break;
        case "grain":
          if (!initialMeasureBoardGrainFor(String(updated.board ?? "").trim())) {
            updated.grainValue = "";
            updated.grain = false;
            break;
          }
          updated.grainValue = String(value ?? "").trim();
          updated.grain = Boolean(updated.grainValue);
          break;
        case "clashing": {
          const split = splitClashing(value);
          updated.clashLeft = split.left;
          updated.clashRight = split.right;
          updated.clashing = joinClashing(split.left, split.right);
          break;
        }
        case "room":
          updated.room = value || "Project Cutlist";
          break;
        case "partType":
          updated.partType = value;
          break;
        case "height":
        case "width":
        case "depth":
        case "quantity":
          updated[target.key] = numericOnlyText(value);
          break;
        default:
          updated[target.key] = value;
          break;
      }
      return updated;
    });
    const updatedRow = next.find((row) => row.id === target.rowId) ?? null;
    if (previousRow && updatedRow && target.key === "partType" && previousRow.partType !== updatedRow.partType) {
      const changedRowName = String(updatedRow.name || previousRow.name || "Unnamed Row").trim();
      logCutlistActivity(`${changedRowName} | Part Type:`, {
        partType: previousRow.partType,
        partTypeTo: updatedRow.partType,
        scope: "initial",
      });
    }
    if (previousRow && updatedRow && target.key !== "partType") {
      const trackedKeys = new Set<CutlistEditableField>(["board", "name", "height", "width", "depth", "quantity", "clashing", "grain", "room"]);
      if (trackedKeys.has(target.key)) {
        const before = cutlistValueForActivity(previousRow, target.key);
        const after = cutlistValueForActivity(updatedRow, target.key);
        if (before !== after) {
          const changedRowName = String(updatedRow.name || previousRow.name || "Unnamed Row").trim();
          logCutlistActivity(`${changedRowName} | ${cutlistFieldLabel(target.key)}:`, {
            partType: updatedRow.partType || previousRow.partType,
            valueFrom: before,
            valueTo: after,
            dedupeKey: `initial:change:${updatedRow.id}:${target.key}:${before}->${after}`,
            scope: "initial",
          });
        }
      }
    }
    setInitialCutlistRows(next);
    setInitialEditingCell(null);
    setInitialEditingCellValue("");
    await persistInitialCutlistRows(next);
  };

  const isInitialEditing = (rowId: string, key: CutlistEditableField) =>
    initialEditingCell?.rowId === rowId && initialEditingCell.key === key;
  const initialCutlistEntryCellStyle = (key: CutlistEditableField, span = 1) => {
    const order = initialCutlistEntryOrderMap.get(key);
    if (order == null) return { display: "none" };
    return {
      order: order * 10,
      gridColumn: `span ${span} / span ${span}`,
    };
  };
  const initialCutlistEntrySubCellStyle = (key: CutlistEditableField, offset: number) => {
    const order = initialCutlistEntryOrderMap.get(key);
    if (order == null) return { display: "none" };
    return { order: order * 10 + offset };
  };
  const onUpdateOrderHingeRow = (rowId: string, patch: Partial<OrderHingeRow>) => {
    setOrderHingeRowsByCategory((prev) => {
      const current = prev[orderSelectedHardwareCategoryKey] ?? [];
      return {
        ...prev,
        [orderSelectedHardwareCategoryKey]: current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
      };
    });
  };
  const onOrderHingeTypeChange = async (rowId: string, value: string) => {
    const prev = orderHingeRowsByCategoryRef.current;
    const current = prev[orderSelectedHardwareCategoryKey] ?? [];
    const nextRows = current.map((row) => (row.id === rowId ? { ...row, name: value } : row));
    const next = {
      ...prev,
      [orderSelectedHardwareCategoryKey]: nextRows,
    };
    orderHingeRowsByCategoryRef.current = next;
    setOrderHingeRowsByCategory(next);
    await persistOrderHingeDraft(next);
  };
  const onOrderHingeQtyBlur = async (rowId: string, value: string) => {
    const prev = orderHingeRowsByCategoryRef.current;
    const current = prev[orderSelectedHardwareCategoryKey] ?? [];
    const nextRows = current.map((row) => (row.id === rowId ? { ...row, qty: value } : row));
    const next = {
      ...prev,
      [orderSelectedHardwareCategoryKey]: nextRows,
    };
    orderHingeRowsByCategoryRef.current = next;
    setOrderHingeRowsByCategory(next);
    await persistOrderHingeDraft(next);
  };
  const onOrderMiscDraftChange = (lineKey: string, patch: Partial<OrderMiscDraftRow>) => {
    const categoryKey = orderSelectedHardwareCategoryKey;
    const prev = orderMiscDraftByCategoryRef.current;
    const categoryRows = { ...(prev[categoryKey] ?? {}) };
    const row = { ...(categoryRows[lineKey] ?? { name: "", notes: "", qty: "", deleted: false }), ...patch };
    categoryRows[lineKey] = row;
    const next = {
      ...prev,
      [categoryKey]: categoryRows,
    };
    orderMiscDraftByCategoryRef.current = next;
    setOrderMiscDraftByCategory(next);
  };
  const onOrderMiscDraftBlur = async (lineKey: string, patch: Partial<OrderMiscDraftRow>) => {
    const categoryKey = orderSelectedHardwareCategoryKey;
    const prev = orderMiscDraftByCategoryRef.current;
    const categoryRows = { ...(prev[categoryKey] ?? {}) };
    const row = { ...(categoryRows[lineKey] ?? { name: "", notes: "", qty: "", deleted: false }), ...patch };
    categoryRows[lineKey] = row;
    const next = {
      ...prev,
      [categoryKey]: categoryRows,
    };
    orderMiscDraftByCategoryRef.current = next;
    setOrderMiscDraftByCategory(next);
    await persistOrderMiscDraft(next);
  };
  const onAddOrderMiscRow = async () => {
    const categoryKey = orderSelectedHardwareCategoryKey;
    const prev = orderMiscDraftByCategoryRef.current;
    const categoryRows = { ...(prev[categoryKey] ?? {}) };
    const lineKey = `misc_custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`.toLowerCase();
    categoryRows[lineKey] = { name: "", notes: "", qty: "", deleted: false };
    const next = {
      ...prev,
      [categoryKey]: categoryRows,
    };
    orderMiscDraftByCategoryRef.current = next;
    setOrderMiscDraftByCategory(next);
    await persistOrderMiscDraft(next);
  };
  const onDeleteOrderMiscRow = async (lineKey: string) => {
    const categoryKey = orderSelectedHardwareCategoryKey;
    const prev = orderMiscDraftByCategoryRef.current;
    const categoryRows = { ...(prev[categoryKey] ?? {}) };
    const current = { ...(categoryRows[lineKey] ?? { name: "", notes: "", qty: "", deleted: false }) };
    categoryRows[lineKey] = { ...current, deleted: true };
    const next = {
      ...prev,
      [categoryKey]: categoryRows,
    };
    orderMiscDraftByCategoryRef.current = next;
    setOrderMiscDraftByCategory(next);
    await persistOrderMiscDraft(next);
  };
  const onDeleteOrderHingeRow = async (rowId: string) => {
    const prev = orderHingeRowsByCategoryRef.current;
    const current = prev[orderSelectedHardwareCategoryKey] ?? [];
    const nextRows = current.filter((row) => row.id !== rowId);
    const next = {
      ...prev,
      [orderSelectedHardwareCategoryKey]: nextRows,
    };
    orderHingeRowsByCategoryRef.current = next;
    setOrderHingeRowsByCategory(next);
    await persistOrderHingeDraft(next);
  };
  const onSaveAndBackFromCutlist = async () => {
    await persistCutlistRows(cutlistRows);
    setProductionNav("overview");
    setNestingFullscreen(false);
  };

  const onSaveAndBackFromNesting = async () => {
    await persistCutlistRows(cutlistRows);
    setProductionNav("overview");
    setNestingFullscreen(false);
    setNestingSheetPreview(null);
    setNestingPreviewHoverPieceId(null);
    setNestingTooltip(null);
  };

  const onSaveAndBackFromCnc = async () => {
    await persistCutlistRows(cutlistRows);
    setProductionNav("overview");
    setNestingFullscreen(false);
  };
  const onSaveAndBackFromOrder = async () => {
    await persistCutlistRows(cutlistRows);
    setProductionNav("overview");
    setNestingFullscreen(false);
  };

  const onPrintCnc = () => {
    onExportCncPdf("print");
  };

  const onExportCncXlsx = async () => {
    if (typeof window === "undefined") return;
    const safeProject = (project?.name || "project")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 64);
    const fileName = `${safeProject}_cnc_cutlist.xlsx`;
    const header = [
      "ID",
      "Room",
      "Part Type",
      "Part Name",
      "Height",
      "Width",
      "Depth",
      "Qty",
      "Clashing",
      ...(showCncGrainColumn ? ["Grain"] : []),
      "Information",
    ];
    const colCount = header.length;
    const spacerCols = 1;
    const infoCol = colCount; // 1-based index in worksheet
    const extraInfoColsNarrow = 1;
    const extraInfoColsWide = 3;
    const extraInfoCols = extraInfoColsNarrow + extraInfoColsWide;
    const totalCols = spacerCols + colCount + extraInfoCols;
    const { Workbook } = await import("exceljs");
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("CNC Cutlist");

    const toArgb = (hex: string, fallback = "FF2F6BFF") => {
      const clean = String(hex || "").replace("#", "").trim();
      if (clean.length === 3) return `FF${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`.toUpperCase();
      if (clean.length === 6) return `FF${clean}`.toUpperCase();
      return fallback;
    };

    const themeBg = toArgb(companyThemeColor);
    const headerFont = toArgb(cncHeaderTextColor, "FFFFFFFF");
    const blackBg = "FF111111";
    const whiteFont = "FFFFFFFF";
    const zebraBg = "FFF6F8FB";
    const whiteBg = "FFFFFFFF";
    const darkBorder = "FF111111";
    const centeredCols = new Set(["ID", "Height", "Width", "Depth", "Qty", "Clashing", "Grain"]);
    const helperEnabledAny = productionForm.boardTypes.some((row) => Boolean(row.grain));
    const helperWord = "Underlined";
    const helperTail = " Dimension has grain along it.";
    const buildDimExcelRichText = (
      height: string,
      width: string,
      depth: string,
      grainValue: string,
      qtySuffix = "",
    ) => {
      const parts: Array<{ key: "height" | "width" | "depth"; value: string }> = [];
      const h = String(height || "").trim();
      const w = String(width || "").trim();
      const d = String(depth || "").trim();
      if (h) parts.push({ key: "height", value: h });
      if (w) parts.push({ key: "width", value: w });
      if (d) parts.push({ key: "depth", value: d });
      if (parts.length === 0) return "";
      const richText: Array<{ text: string; font?: Record<string, unknown> }> = [];
      parts.forEach((part, idx) => {
        if (idx > 0) richText.push({ text: " x ", font: { color: { argb: "FF0F172A" }, size: 10 } });
        const isMatch = matchesGrainDimension(grainValue, part.value, part.key);
        richText.push({
          text: part.value,
          font: {
            color: { argb: "FF0F172A" },
            size: 10,
            bold: isMatch,
            underline: isMatch ? true : undefined,
          },
        });
      });
      if (qtySuffix) {
        richText.push({ text: qtySuffix, font: { color: { argb: "FF0F172A" }, size: 10 } });
      }
      return { richText };
    };

    const baseWidths = [7, 14, 12, 34, 9, 9, 9, 8, 12, ...(showCncGrainColumn ? [10] : []), 34];
    const heightLikeWidth = baseWidths[4] ?? 9; // match Height column width
    const normalExtraWidth = 12;
    const widths = Array.from({ length: totalCols }, (_, i) => {
      if (i < spacerCols) return Math.max(3, (baseWidths[0] ?? 7) / 2);
      const dataIdx = i - spacerCols;
      // Keep all fixed columns before Information as-is.
      if (dataIdx < colCount - 1) return baseWidths[dataIdx] ?? 12;
      // Make Information base column (K) match Height width.
      if (dataIdx === colCount - 1) return heightLikeWidth;
      // Extra Information expansion columns to the right.
      const extraIdx = dataIdx - colCount;
      return extraIdx < extraInfoColsNarrow ? heightLikeWidth : normalExtraWidth;
    });
    sheet.columns = widths.map((w) => ({ width: w }));

    const darkEdgeBorder = {
      top: { style: "thin", color: { argb: darkBorder } },
      left: { style: "thin", color: { argb: darkBorder } },
      right: { style: "thin", color: { argb: darkBorder } },
      bottom: { style: "thin", color: { argb: darkBorder } },
    } as const;

    const setRangeFill = (rowStart: number, rowEnd: number, colStart: number, colEnd: number, argb: string) => {
      for (let r = rowStart; r <= rowEnd; r += 1) {
        for (let c = colStart; c <= colEnd; c += 1) {
          const cell = sheet.getCell(r, c);
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
        }
      }
    };

    const setRangeOuterBorder = (rowStart: number, rowEnd: number, colStart: number, colEnd: number) => {
      const thin = { style: "thin" as const, color: { argb: darkBorder } };
      for (let r = rowStart; r <= rowEnd; r += 1) {
        for (let c = colStart; c <= colEnd; c += 1) {
          const cell = sheet.getCell(r, c);
          const top = r === rowStart ? thin : cell.border?.top;
          const bottom = r === rowEnd ? thin : cell.border?.bottom;
          const left = c === colStart ? thin : cell.border?.left;
          const right = c === colEnd ? thin : cell.border?.right;
          cell.border = { top, bottom, left, right } as any;
        }
      }
    };

    const setVerticalDividers = (rowStart: number, rowEnd: number, colStart: number, colEnd: number) => {
      for (let r = rowStart; r <= rowEnd; r += 1) {
        for (let c = colStart; c <= colEnd; c += 1) {
          const cell = sheet.getCell(r, c);
          cell.border = {
            ...cell.border,
            left: { style: "thin", color: { argb: darkBorder } },
            right: { style: "thin", color: { argb: darkBorder } },
          };
        }
      }
    };

    let rowPtr = 1;
    let runningId = 0;
    for (const group of cncRowsByBoardNonCab) {
      const boardHasGrain = boardGrainFor(group.boardKey);
      const tableStartCol = spacerCols + 1;
      const leftEnd = Math.max(tableStartCol, totalCols - 5);
      sheet.mergeCells(rowPtr, tableStartCol, rowPtr, leftEnd);
      if (boardHasGrain) {
        sheet.mergeCells(rowPtr, leftEnd + 1, rowPtr, totalCols);
      } else {
        sheet.mergeCells(rowPtr, leftEnd + 1, rowPtr, totalCols);
      }
      const titleCell = sheet.getCell(rowPtr, tableStartCol);
      titleCell.value = String(group.boardLabel || "Board");
      titleCell.font = { bold: true, color: { argb: whiteFont }, size: 14 };
      titleCell.alignment = { horizontal: "left", vertical: "middle" };
      const helperCell = sheet.getCell(rowPtr, leftEnd + 1);
      if (boardHasGrain) {
        helperCell.value = {
          richText: [
            { text: helperWord, font: { bold: true, underline: true, color: { argb: whiteFont }, size: 11 } },
            { text: helperTail, font: { bold: false, color: { argb: whiteFont }, size: 11 } },
          ],
        };
        helperCell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        helperCell.value = "";
      }
      setRangeFill(rowPtr, rowPtr, tableStartCol, totalCols, blackBg);
      setRangeOuterBorder(rowPtr, rowPtr, tableStartCol, totalCols);
      sheet.getRow(rowPtr).height = 22;
      rowPtr += 1;

      for (let i = 0; i < header.length - 1; i += 1) {
        const c = tableStartCol + i;
        const cell = sheet.getCell(rowPtr, c);
        cell.value = header[i];
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: themeBg } };
        cell.font = { bold: true, color: { argb: headerFont }, size: 11 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = darkEdgeBorder;
      }
      const infoStartCol = tableStartCol + infoCol - 1;
      sheet.mergeCells(rowPtr, infoStartCol, rowPtr, totalCols);
      const infoHeadCell = sheet.getCell(rowPtr, infoStartCol);
      infoHeadCell.value = "Information";
      infoHeadCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: themeBg } };
      infoHeadCell.font = { bold: true, color: { argb: headerFont }, size: 11 };
      infoHeadCell.alignment = { horizontal: "center", vertical: "middle" };
      infoHeadCell.border = darkEdgeBorder;
      sheet.getRow(rowPtr).height = 20;
      const dataStart = rowPtr + 1;
      rowPtr += 1;

      let lastIdKey = "";
      let stripeIndex = -1;
      let lastStripeKey = "";
      for (let rowIndex = 0; rowIndex < group.rows.length; rowIndex += 1) {
        const row = group.rows[rowIndex];
        const isDrawer = isDrawerPartType(row.partType);
        const drawerSourceKey = isDrawer ? String((row as CncDisplayRow).sourceRowId || row.id) : "";
        const prevDrawer =
          rowIndex > 0 && isDrawerPartType(group.rows[rowIndex - 1].partType)
            ? group.rows[rowIndex - 1]
            : null;
        const isDrawerContinuation =
          Boolean(prevDrawer) &&
          isDrawer &&
          String((prevDrawer as CncDisplayRow).sourceRowId || prevDrawer?.id || "") === drawerSourceKey;
        let drawerRowSpan = 1;
        if (isDrawer && !isDrawerContinuation) {
          for (let look = rowIndex + 1; look < group.rows.length; look += 1) {
            const next = group.rows[look];
            if (!isDrawerPartType(String(next.partType || ""))) break;
            const nextKey = String((next as CncDisplayRow).sourceRowId || next.id);
            if (nextKey !== drawerSourceKey) break;
            drawerRowSpan += 1;
          }
        }
        const idKey = (isCabinetryPartType(row.partType) || isDrawer)
          ? String((row as CncDisplayRow).sourceRowId || row.id)
          : String(row.id);
        if (idKey !== lastIdKey) {
          runningId += 1;
          lastIdKey = idKey;
        }
        const stripeKey = isDrawer ? String((row as CncDisplayRow).sourceRowId || row.id) : String(row.id);
        if (stripeKey !== lastStripeKey) {
          stripeIndex += 1;
          lastStripeKey = stripeKey;
        }
        const stripeBg = stripeIndex % 2 === 1 ? zebraBg : whiteBg;
        const partTypeForOutput = String(row.partType ?? "");
        const values = [
          String(runningId),
          String(row.room ?? ""),
          partTypeForOutput,
          String(row.name ?? ""),
          String(row.height ?? ""),
          String(row.width ?? ""),
          String(row.depth ?? ""),
          String(row.quantity ?? ""),
          String(joinClashing(String(row.clashLeft ?? ""), String(row.clashRight ?? "")) ?? ""),
          ...(showCncGrainColumn ? [String(row.grainValue ?? "")] : []),
          String(row.information ?? ""),
        ];
        for (let i = 0; i < values.length - 1; i += 1) {
          const c = tableStartCol + i;
          const label = header[i] ?? "";
          const cell = sheet.getCell(rowPtr, c);
          const isMergedIdentityCol = isDrawer && i <= 2;
          if (isMergedIdentityCol && isDrawerContinuation) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: stripeBg } };
            cell.border = {
              left: { style: "thin", color: { argb: darkBorder } },
              right: { style: "thin", color: { argb: darkBorder } },
            };
            continue;
          }
          if (isMergedIdentityCol && drawerRowSpan > 1) {
            sheet.mergeCells(rowPtr, c, rowPtr + drawerRowSpan - 1, c);
          }
          cell.value = values[i];
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: stripeBg } };
          cell.font = { color: { argb: "FF0F172A" }, size: 10 };
          const isDrawerGroupedCell = isMergedIdentityCol && drawerRowSpan > 1;
          cell.alignment = {
            horizontal: isDrawerGroupedCell ? "center" : (centeredCols.has(label) ? "center" : "left"),
            vertical: "middle",
          };
          cell.border = {
            left: { style: "thin", color: { argb: darkBorder } },
            right: { style: "thin", color: { argb: darkBorder } },
          };
        }
        const infoValue = values[values.length - 1] ?? "";
        const infoStartCol = tableStartCol + infoCol - 1;
        sheet.mergeCells(rowPtr, infoStartCol, rowPtr, totalCols);
        const infoCell = sheet.getCell(rowPtr, infoStartCol);
        infoCell.value = infoValue;
        infoCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: stripeBg } };
        infoCell.font = { color: { argb: "FF0F172A" }, size: 10 };
        infoCell.alignment = { horizontal: "left", vertical: "middle" };
        infoCell.border = {
          left: { style: "thin", color: { argb: darkBorder } },
          right: { style: "thin", color: { argb: darkBorder } },
        };
        const rowPartType = String(row.partType ?? "").trim();
        const partTypeHex = normalizeHexColor(partTypeColors[rowPartType] ?? partTypeColors[rowPartType.toLowerCase()] ?? "");
        if (partTypeHex) {
          const partCell = sheet.getCell(rowPtr, tableStartCol + 2);
          const partArgb = toArgb(partTypeHex);
          if (isDrawer && drawerRowSpan > 1) {
            setRangeFill(rowPtr, rowPtr + drawerRowSpan - 1, tableStartCol + 2, tableStartCol + 2, partArgb);
          } else {
            partCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: partArgb } };
          }
          partCell.font = { bold: true, color: { argb: isLightHex(partTypeHex) ? "FF0F172A" : "FFFFFFFF" }, size: 10 };
          partCell.alignment = { horizontal: "center", vertical: "middle" };
        }

        const boardHasGrainForRow = boardGrainFor(String(row.board || "").trim());
        const grainValue = String(row.grainValue ?? "");
        const matchCols = [
          matchesGrainDimension(grainValue, String(row.height ?? ""), "height"),
          matchesGrainDimension(grainValue, String(row.width ?? ""), "width"),
          matchesGrainDimension(grainValue, String(row.depth ?? ""), "depth"),
        ];
        if (boardHasGrainForRow) {
          [5, 6, 7].forEach((col, idx) => {
            if (matchCols[idx]) {
              const c = sheet.getCell(rowPtr, tableStartCol + col - 1);
              c.font = { ...(c.font ?? {}), bold: true, underline: true, color: { argb: "FF0F172A" }, size: 10 };
            }
          });
        }
        sheet.getRow(rowPtr).height = 18;
        rowPtr += 1;
      }
      const dataEnd = rowPtr - 1;
      if (dataEnd >= dataStart) {
        setVerticalDividers(dataStart, dataEnd, tableStartCol, totalCols);
        setRangeOuterBorder(rowPtr - (dataEnd - dataStart + 1) - 1, dataEnd, tableStartCol, totalCols);
      }
      rowPtr += 1; // one-row gap between board tables
    }

    if (cncCabinetCards.length > 0) {
      const tableStartCol = spacerCols + 1;
      const leftEnd = Math.max(tableStartCol, totalCols - 5);
      sheet.mergeCells(rowPtr, tableStartCol, rowPtr, leftEnd);
      sheet.mergeCells(rowPtr, leftEnd + 1, rowPtr, totalCols);
      const t = sheet.getCell(rowPtr, tableStartCol);
      t.value = "Cabinets";
      t.font = { bold: true, color: { argb: whiteFont }, size: 14 };
      t.alignment = { horizontal: "left", vertical: "middle" };
      if (helperEnabledAny) {
        const helperCell = sheet.getCell(rowPtr, leftEnd + 1);
        helperCell.value = {
          richText: [
            { text: helperWord, font: { bold: true, underline: true, color: { argb: whiteFont }, size: 11 } },
            { text: helperTail, font: { bold: false, color: { argb: whiteFont }, size: 11 } },
          ],
        };
        helperCell.alignment = { horizontal: "right", vertical: "middle" };
      }
      setRangeFill(rowPtr, rowPtr, tableStartCol, totalCols, blackBg);
      setRangeOuterBorder(rowPtr, rowPtr, tableStartCol, totalCols);
      sheet.getRow(rowPtr).height = 22;
      rowPtr += 1;

      for (const card of cncCabinetCards) {
        const cardStart = rowPtr;
        const headerRow = rowPtr;
        const bodyStart = headerRow + 1;
        const bodyRows = 6;
        const bodyEnd = bodyStart + bodyRows - 1;
        const cardEnd = bodyEnd;

        const tableStartCol = spacerCols + 1;
        sheet.mergeCells(headerRow, tableStartCol + 1, headerRow, totalCols);
        sheet.getCell(headerRow, tableStartCol).value = String(card.displayId);
        sheet.getCell(headerRow, tableStartCol + 1).value = String(card.row.name || "-");
        sheet.getCell(headerRow, tableStartCol).alignment = { horizontal: "center", vertical: "middle" };
        sheet.getCell(headerRow, tableStartCol).font = { color: { argb: "FF0F172A" }, size: 11 };
        sheet.getCell(headerRow, tableStartCol + 1).font = { bold: true, color: { argb: "FF0F172A" }, size: 11 };
        sheet.getCell(headerRow, tableStartCol + 1).alignment = { horizontal: "left", vertical: "middle" };
        setRangeFill(headerRow, headerRow, tableStartCol, totalCols, "FFF5F8FC");
        for (let c = tableStartCol; c <= totalCols; c += 1) {
          const cell = sheet.getCell(headerRow, c);
          cell.border = {
            ...(cell.border ?? {}),
            bottom: { style: "thin", color: { argb: darkBorder } },
          } as any;
        }
        sheet.getRow(headerRow).height = 22;

        // Image area C:E across full cabinetry card body height.
        const imageColStart = tableStartCol + 1; // C
        const imageColEnd = tableStartCol + 3; // E
        const imageRowEnd = bodyEnd;
        sheet.mergeCells(bodyStart, imageColStart, imageRowEnd, imageColEnd);
        // Left detail labels/values F:K
        // Right detail labels/values M:... (to totalCols)
        const leftLabelColStart = tableStartCol + 4;
        const leftLabelColEnd = tableStartCol + 5;
        const leftValueColStart = tableStartCol + 6;
        const leftValueColEnd = tableStartCol + 9;
        const rightLabelColStart = tableStartCol + 10;
        const rightLabelColEnd = tableStartCol + 11;
        const rightValueColStart = tableStartCol + 12;
        const rightValueColEnd = totalCols;

        const topBottomPiece = card.cabinetryPieces.top ?? card.cabinetryPieces.bottom;
        const leftRightPiece = card.cabinetryPieces.left_side ?? card.cabinetryPieces.right_side;
        const backPiece = card.cabinetryPieces.back;
        const fixedPiece = card.cabinetryPieces.fixed_shelf;
        const adjustablePiece = card.cabinetryPieces.adjustable_shelf;
        const infoLines = card.infoLines.length ? card.infoLines : [""];
        const leftRows: Array<[string, string]> = [
          ["Material", card.boardLabel || "-"],
          ["Quantity", String(card.row.quantity || "")],
          ["Size (H x W x D)", card.sizeLabel || "-"],
          [card.fixedShelf === 1 ? "Fixed Shelf" : "Fixed Shelves", card.fixedShelf > 0 ? `${card.fixedShelf} (${String(normalizeDrillingValue(card.row.fixedShelfDrilling || "No")).toLowerCase()} drilling)` : ""],
          [card.adjustableShelf === 1 ? "Adjustable Shelf" : "Adjustable Shelves", card.adjustableShelf > 0 ? `${card.adjustableShelf} (${String(normalizeDrillingValue(card.row.adjustableShelfDrilling || "No")).toLowerCase()} drilling)` : ""],
          ["Information", infoLines.join("\n")],
        ];
        const rightRows: Array<[string, string]> = [
          ["Top / Bottom", ""],
          ["Left / Right Side", ""],
          ["Back", ""],
          ["Fixed Shelf", ""],
          ["Adjustable Shelf", ""],
          ["", ""],
        ];

        for (let i = 0; i < bodyRows; i += 1) {
          const r = bodyStart + i;
          sheet.mergeCells(r, leftLabelColStart, r, leftLabelColEnd);
          sheet.mergeCells(r, leftValueColStart, r, leftValueColEnd);
          sheet.mergeCells(r, rightLabelColStart, r, rightLabelColEnd);
          sheet.mergeCells(r, rightValueColStart, r, rightValueColEnd);
          const [lk, lv] = leftRows[i];
          const [rk, rv] = rightRows[i];
          const lkc = sheet.getCell(r, leftLabelColStart);
          lkc.value = lk;
          lkc.font = { bold: true, color: { argb: "FF0F172A" }, size: 10 };
          lkc.alignment = { horizontal: "left", vertical: "middle" };
          const lvc = sheet.getCell(r, leftValueColStart);
          if (i === 2) {
            lvc.value = buildDimExcelRichText(
              String(card.row.height ?? ""),
              String(card.row.width ?? ""),
              String(card.row.depth ?? ""),
              String(card.row.grainValue ?? ""),
            ) as any;
          } else {
            lvc.value = lv;
          }
          lvc.font = { color: { argb: "FF0F172A" }, size: 10 };
          lvc.alignment = { horizontal: "left", vertical: "middle", wrapText: i === 5 };

          const rkc = sheet.getCell(r, rightLabelColStart);
          rkc.value = rk;
          rkc.font = { bold: true, color: { argb: "FF0F172A" }, size: 10 };
          rkc.alignment = { horizontal: "left", vertical: "middle" };
          const rvc = sheet.getCell(r, rightValueColStart);
          if (i <= 4) {
            const piece =
              i === 0 ? topBottomPiece :
              i === 1 ? leftRightPiece :
              i === 2 ? backPiece :
              i === 3 ? fixedPiece :
              adjustablePiece;
            if (piece) {
              const qty = Number.parseInt(String(piece.quantity || "0"), 10) || 0;
              const qtyMultiplier = i <= 1 ? 2 : 1;
              const finalQty = qty > 0 ? qty * qtyMultiplier : 0;
              rvc.value = buildDimExcelRichText(
                String(piece.height ?? ""),
                String(piece.width ?? ""),
                String(piece.depth ?? ""),
                cabinetryPieceGrainValue(card.row, piece),
                finalQty > 0 ? ` (x${finalQty})` : "",
              ) as any;
            } else {
              rvc.value = rv;
            }
          } else {
            rvc.value = rv;
          }
          rvc.font = { color: { argb: "FF0F172A" }, size: 10 };
          rvc.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
          sheet.getRow(r).height = i === 5 ? Math.max(20, 16 + Math.max(0, infoLines.length - 1) * 14) : 20;
        }

        setRangeFill(bodyStart, bodyEnd, tableStartCol, totalCols, whiteBg);
        setRangeOuterBorder(cardStart, cardEnd, tableStartCol, totalCols);
        setVerticalDividers(cardStart, cardEnd, tableStartCol, totalCols);

        const cacheKey = cabinetPdfImageKey(card);
        const cachedImg = cabinetPdfImageCacheRef.current[cacheKey];
        let dataUrl = cachedImg?.url || "";
        let imageRatio = cachedImg && cachedImg.svgH > 0 ? (cachedImg.svgW / cachedImg.svgH) : 1;
        if (!dataUrl) {
          const svg = buildCabinetSvgForExport(
            card.widthMm,
            card.heightMm,
            card.depthMm,
            card.thicknessMm,
            card.fixedShelf,
            card.adjustableShelf,
          );
          if (svg) {
            imageRatio = svg.svgH > 0 ? (svg.svgW / svg.svgH) : imageRatio;
            dataUrl = await cabinetSvgMarkupToPngDataUrl(
              svg.svg,
              Math.max(240, Math.floor(svg.svgW * 3)),
              Math.max(240, Math.floor(svg.svgH * 3)),
            );
          }
        }
        if (dataUrl) {
          const colWidthPx = (col1Based: number) => {
            const wch = Number(sheet.getColumn(col1Based).width ?? 8);
            return Math.max(1, Math.round(wch * 7 + 5));
          };
          const rowHeightPx = (row1Based: number) => {
            const hpt = Number(sheet.getRow(row1Based).height ?? 15);
            return Math.max(1, Math.round((hpt * 96) / 72));
          };
          const pxToColUnits = (startCol1Based: number, pxFromStart: number, endCol1Based: number) => {
            let remaining = Math.max(0, pxFromStart);
            let units = 0;
            for (let c = startCol1Based; c <= endCol1Based; c += 1) {
              const w = colWidthPx(c);
              if (remaining <= w) {
                units += remaining / Math.max(1, w);
                return units;
              }
              units += 1;
              remaining -= w;
            }
            return units;
          };
          const pxToRowUnits = (startRow1Based: number, pxFromStart: number, endRow1Based: number) => {
            let remaining = Math.max(0, pxFromStart);
            let units = 0;
            for (let r = startRow1Based; r <= endRow1Based; r += 1) {
              const h = rowHeightPx(r);
              if (remaining <= h) {
                units += remaining / Math.max(1, h);
                return units;
              }
              units += 1;
              remaining -= h;
            }
            return units;
          };
          let areaWpx = 0;
          for (let c = imageColStart; c <= imageColEnd; c += 1) areaWpx += colWidthPx(c);
          let areaHpx = 0;
          for (let r = bodyStart; r <= imageRowEnd; r += 1) areaHpx += rowHeightPx(r);
          const imageInsetPx = 8;
          const fitWpx = Math.max(1, areaWpx - imageInsetPx * 2);
          const fitHpx = Math.max(1, areaHpx - imageInsetPx * 2);
          // Keep XLSX previews locked to the cabinet's true dimension-based ratio.
          // This avoids renderer/metadata drift and matches PDF cabinet proportions.
          const ratioFromDims = cabinetPreviewRatioFromDims(card.widthMm, card.heightMm, card.depthMm);
          const safeRatio =
            Number.isFinite(ratioFromDims) && ratioFromDims > 0
              ? ratioFromDims
              : (Number.isFinite(imageRatio) && imageRatio > 0 ? imageRatio : 1);
          let drawWpx = fitWpx;
          let drawHpx = drawWpx / safeRatio;
          if (drawHpx > fitHpx) {
            drawHpx = fitHpx;
            drawWpx = drawHpx * safeRatio;
          }
          const offsetXpx = imageInsetPx + (fitWpx - drawWpx) / 2;
          const offsetYpx = imageInsetPx + (fitHpx - drawHpx) / 2;
          const tlCol = (imageColStart - 1) + pxToColUnits(imageColStart, offsetXpx, imageColEnd);
          const tlRow = (bodyStart - 1) + pxToRowUnits(bodyStart, offsetYpx, imageRowEnd);
          const imgId = workbook.addImage({ base64: dataUrl, extension: "png" });
          sheet.addImage(imgId, {
            // ExcelJS image anchors are zero-based.
            // Place image as "contain" centered in merged C:E image area.
            // Use ext (px) so Excel keeps aspect ratio exactly and does not
            // reinterpret sizing via br cell math.
            tl: { col: tlCol, row: tlRow },
            ext: {
              width: Math.max(1, Math.round(drawWpx)),
              height: Math.max(1, Math.round(drawHpx)),
            },
            editAs: "oneCell",
          } as any);
        }

        rowPtr = cardEnd + 2;
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2500);
  };

  const onExportCncPdf = async (mode: "download" | "print" = "download") => {
    if (typeof window === "undefined") return;
    const safeProject = (project?.name || "project")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 64);
    const fileName = `${safeProject}_cnc_cutlist.pdf`;

    const toRgb = (hex: string) => {
      const normalized = normalizeHexColor(hex) ?? "#2F6BFF";
      const clean = normalized.replace("#", "");
      return [
        Number.parseInt(clean.slice(0, 2), 16),
        Number.parseInt(clean.slice(2, 4), 16),
        Number.parseInt(clean.slice(4, 6), 16),
      ] as [number, number, number];
    };
    const themeRgb = toRgb(companyThemeColor);
    const headerTextRgb = toRgb(cncHeaderTextColor);
    const whiteRgb: [number, number, number] = [255, 255, 255];
    const blackRgb: [number, number, number] = [17, 17, 17];
    const rowAltRgb: [number, number, number] = [246, 248, 251];
    const rowBaseRgb: [number, number, number] = [255, 255, 255];

    const header = ["ID", "Room", "Part Type", "Part Name", "Height", "Width", "Depth", "Qty", "Clashing", ...(showCncGrainColumn ? ["Grain"] : []), "Information"];
    const centeredCols = new Set(["ID", "Part Type", "Height", "Width", "Depth", "Qty", "Clashing", "Grain"]);

    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const sidePad = 18;
    const topPad = 18;
    const boardBarHeight = 22;
    const pxToPt = 0.75;
    const usableTableWidthPt = pageWidth - sidePad * 2;
    const allPdfRows = cncRowsByBoardNonCab.flatMap((group) => group.rows);
    const anyBoardHasGrain = productionForm.boardTypes.some((row) => Boolean(row.grain));
    const helperWord = "Underlined";
    const helperTail = " Dimension has grain along it.";
    const colValues = {
      id: allPdfRows.map((_row, idx) => String(idx + 1)),
      room: allPdfRows.map((row) => String(row.room ?? "")),
      partType: allPdfRows.map((row) => String(row.partType ?? "")),
      partName: allPdfRows.map((row) => String(row.name ?? "")),
      height: allPdfRows.map((row) => String(row.height ?? "")),
      width: allPdfRows.map((row) => String(row.width ?? "")),
      depth: allPdfRows.map((row) => String(row.depth ?? "")),
      quantity: allPdfRows.map((row) => String(row.quantity ?? "")),
      clashing: allPdfRows.map((row) => String(joinClashing(String(row.clashLeft ?? ""), String(row.clashRight ?? "")) ?? "")),
      grain: allPdfRows.map((row) => String(row.grainValue ?? "")),
      information: allPdfRows.map((row) => String(row.information ?? "")),
    };
    const fitColPx = (values: string[], minPx: number, maxPx: number, padPx = 14) =>
      Math.max(
        minPx,
        Math.min(
          maxPx,
          Math.ceil(Math.max(0, ...values.map((v) => approximateTextWidthPx(String(v || "")))) + padPx),
        ),
      );

    const heightPx = fitColPx(colValues.height, 26, 48, 8);
    const widthPx = fitColPx(colValues.width, 26, 48, 8);
    const depthPx = fitColPx(colValues.depth, 26, 48, 8);
    const qtyPx = fitColPx(colValues.quantity, 30, 56, 8);
    const clashPx = fitColPx(colValues.clashing, 34, 62, 8);
    const grainPx = showCncGrainColumn ? fitColPx(colValues.grain, 40, 64, 10) : 0;
    const headerFitPt = (label: string, sidePadPx = 8) =>
      (approximateTextWidthPx(label) + sidePadPx * 2) * pxToPt;
    const tightWidthPtByHeader: Record<string, number> = {
      Height: Math.max(headerFitPt("Height"), Math.max(18, Math.min(28, heightPx * pxToPt))),
      Width: Math.max(headerFitPt("Width"), Math.max(18, Math.min(28, widthPx * pxToPt))),
      Depth: Math.max(headerFitPt("Depth"), Math.max(18, Math.min(28, depthPx * pxToPt))),
      Qty: Math.max(headerFitPt("Qty"), Math.max(20, Math.min(32, qtyPx * pxToPt))),
      Clashing: Math.max(headerFitPt("Clashing"), Math.max(22, Math.min(36, clashPx * pxToPt))),
    };
    if (showCncGrainColumn) {
      tightWidthPtByHeader.Grain = Math.max(headerFitPt("Grain"), Math.max(20, Math.min(30, grainPx * pxToPt)));
    }
    const globalColumnWidthPtByHeader: Record<string, number> = {
      ID: Math.max(headerFitPt("ID", 6), 24),
      Room: Math.max(headerFitPt("Room", 8), fitColPx(colValues.room, 56, 260, 16) * pxToPt),
      "Part Type": Math.max(headerFitPt("Part Type", 8), fitColPx(colValues.partType, 52, 130, 16) * pxToPt),
      "Part Name": Math.max(headerFitPt("Part Name", 8), fitColPx(colValues.partName, 74, 460, 18) * pxToPt),
      ...tightWidthPtByHeader,
    };
    const infoHeader = "Information";
    const usedNonInfoPt = header.reduce((sum, name) => {
      if (name === infoHeader) return sum;
      return sum + (globalColumnWidthPtByHeader[name] ?? 0);
    }, 0);
    const infoPt = Math.max(headerFitPt(infoHeader, 8), usableTableWidthPt - usedNonInfoPt);
    globalColumnWidthPtByHeader[infoHeader] = infoPt;
    // If we still overflow, shrink room and part name first, keep tight columns unchanged.
    let widthOverflow = header.reduce((sum, name) => sum + (globalColumnWidthPtByHeader[name] ?? 0), 0) - usableTableWidthPt;
    if (widthOverflow > 0) {
      const partKey = "Part Name";
      const partMin = Math.max(headerFitPt(partKey, 6), 64 * pxToPt);
      const partNow = globalColumnWidthPtByHeader[partKey] ?? partMin;
      const shrink = Math.min(widthOverflow, Math.max(0, partNow - partMin));
      globalColumnWidthPtByHeader[partKey] = partNow - shrink;
      widthOverflow -= shrink;
    }
    if (widthOverflow > 0) {
      const roomKey = "Room";
      const roomMin = Math.max(headerFitPt(roomKey, 6), 48 * pxToPt);
      const roomNow = globalColumnWidthPtByHeader[roomKey] ?? roomMin;
      const shrink = Math.min(widthOverflow, Math.max(0, roomNow - roomMin));
      globalColumnWidthPtByHeader[roomKey] = roomNow - shrink;
      widthOverflow -= shrink;
    }
    if (widthOverflow > 0) {
      globalColumnWidthPtByHeader[infoHeader] = Math.max(
        headerFitPt(infoHeader, 6),
        (globalColumnWidthPtByHeader[infoHeader] ?? 0) - widthOverflow,
      );
    }

    const companyName = String(
      companyDoc?.companyName ??
      companyDoc?.name ??
      ((companyDoc?.company as Record<string, unknown> | undefined)?.name ?? ""),
    ).trim() || "Company";
    const projectName = String(project?.name || "-").trim() || "-";
    const projectCreator = String(project?.createdByName || "-").trim() || "-";
    const titleLeft = "PROJECT CUTLIST";

    const logoRaw = String(
      companyDoc?.logoPath ??
      companyDoc?.logoUrl ??
      ((companyDoc?.theme as Record<string, unknown> | undefined)?.logoPath ?? ""),
    ).trim();
    const logoResolvedUrl = logoRaw
      ? (await resolveProjectImageUrl(logoRaw)) || (/^https?:\/\//i.test(logoRaw) ? logoRaw : "")
      : "";
    const blobToDataUrl = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("file-reader-failed"));
        reader.readAsDataURL(blob);
      });
    const imageNaturalSize = (dataUrl: string) =>
      new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: Math.max(1, img.naturalWidth || 1), h: Math.max(1, img.naturalHeight || 1) });
        img.onerror = () => resolve({ w: 1, h: 1 });
        img.src = dataUrl;
      });
    let logoDataUrl = "";
    let logoFormat: "PNG" | "JPEG" | "WEBP" = "PNG";
    let logoW = 1;
    let logoH = 1;
    if (logoResolvedUrl) {
      try {
        const resp = await fetch(logoResolvedUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          const mime = String(blob.type || "").toLowerCase();
          if (mime.includes("jpeg") || mime.includes("jpg")) logoFormat = "JPEG";
          else if (mime.includes("webp")) logoFormat = "WEBP";
          else logoFormat = "PNG";
          logoDataUrl = await blobToDataUrl(blob);
          const size = await imageNaturalSize(logoDataUrl);
          logoW = size.w;
          logoH = size.h;
        }
      } catch {
        logoDataUrl = "";
      }
    }

    // Full-page title sheet (shared by PDF export and Print).
    {
      const left = sidePad;
      const right = pageWidth - sidePad;

      // Top-right company logo
      if (logoDataUrl) {
        const maxW = 190;
        const maxH = 90;
        const ratio = logoW / Math.max(1, logoH);
        let drawW = maxW;
        let drawH = drawW / Math.max(0.0001, ratio);
        if (drawH > maxH) {
          drawH = maxH;
          drawW = drawH * ratio;
        }
        const logoX = right - drawW;
        const logoY = topPad + 6;
        doc.addImage(logoDataUrl, logoFormat, logoX, logoY, drawW, drawH);
      }

      // Center the entire title content block on the page.
      const contentHeight = 232;
      const contentTop = Math.max(28, (pageHeight - contentHeight) / 2);
      const titleY = contentTop + 20;
      const firstRuleY = contentTop + 38;
      const projectNameY = contentTop + 66;
      const secondRuleY = contentTop + 90;
      const notesLabelY = contentTop + 132;

      doc.setTextColor(17, 17, 17);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text(titleLeft, left, titleY, { align: "left" });
      doc.text(companyName, right, titleY, { align: "right" });

      doc.setDrawColor(17, 17, 17);
      doc.setLineWidth(0.8);
      doc.line(left, firstRuleY, right, firstRuleY);

      doc.setFontSize(14);
      doc.text(projectName, left, projectNameY, { align: "left" });
      doc.setFontSize(12);
      doc.text(projectCreator, right, projectNameY, { align: "right" });

      doc.line(left, secondRuleY, right, secondRuleY);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("NOTES", left, notesLabelY, { align: "left" });
    }

    // Start CNC tables on the next page after title sheet.
    doc.addPage();

    let runningId = 0;
    cncRowsByBoardNonCab.forEach((group, idx) => {
      if (idx > 0) {
        doc.addPage();
      }
      let lastIdKey = "";
      let stripeIndex = -1;
      let lastStripeKey = "";
      const rowBgByIndex: Array<[number, number, number]> = [];
      const rows = group.rows.map((row, rowIdx) => {
        const partTypeForOutput =
          isCabinetryPartType(row.partType) && (row as CncDisplayRow).cncCabinetryRowKind && (row as CncDisplayRow).cncCabinetryRowKind !== "main"
            ? ""
            : String(row.partType ?? "");
        const isDrawer = isDrawerPartType(row.partType);
        const idKey = (isCabinetryPartType(row.partType) || isDrawer)
          ? String((row as CncDisplayRow).sourceRowId || row.id)
          : String(row.id);
        const stripeKey = isDrawer ? String((row as CncDisplayRow).sourceRowId || row.id) : String(row.id);
        if (stripeKey !== lastStripeKey) {
          stripeIndex += 1;
          lastStripeKey = stripeKey;
        }
        rowBgByIndex.push(stripeIndex % 2 === 1 ? rowAltRgb : rowBaseRgb);
        if (idKey !== lastIdKey) {
          runningId += 1;
          lastIdKey = idKey;
        }
        const prev = rowIdx > 0 ? group.rows[rowIdx - 1] : null;
        const prevDrawerKey = prev && isDrawerPartType(prev.partType) ? String((prev as CncDisplayRow).sourceRowId || prev.id) : "";
        const isDrawerContinuation = isDrawer && prevDrawerKey === String((row as CncDisplayRow).sourceRowId || row.id);
        let drawerRowSpan = 1;
        if (isDrawer && !isDrawerContinuation) {
          for (let i = rowIdx + 1; i < group.rows.length; i += 1) {
            const next = group.rows[i];
            if (!isDrawerPartType(next.partType)) break;
            const nextKey = String((next as CncDisplayRow).sourceRowId || next.id);
            if (nextKey !== String((row as CncDisplayRow).sourceRowId || row.id)) break;
            drawerRowSpan += 1;
          }
        }
        const tailCells: any[] = [
          String(row.name ?? ""),
          String(row.height ?? ""),
          String(row.width ?? ""),
          String(row.depth ?? ""),
          String(row.quantity ?? ""),
          String(joinClashing(String(row.clashLeft ?? ""), String(row.clashRight ?? "")) ?? ""),
          ...(showCncGrainColumn ? [String(row.grainValue ?? "")] : []),
          String(row.information ?? ""),
        ];
        if (isDrawer && isDrawerContinuation) {
          // Important: with rowSpan in first row, continuation rows must not emit overlapped cells.
          return tailCells;
        }
        const idCell: any = isDrawer
          ? { content: String(runningId), rowSpan: drawerRowSpan, styles: { valign: "middle", halign: "center" } }
          : String(runningId);
        const roomCell: any = isDrawer
          ? { content: String(row.room ?? ""), rowSpan: drawerRowSpan, styles: { valign: "middle", halign: "center" } }
          : String(row.room ?? "");
        const typeCell: any = isDrawer
          ? { content: partTypeForOutput, rowSpan: drawerRowSpan, styles: { valign: "middle", halign: "center" } }
          : partTypeForOutput;
        return [idCell, roomCell, typeCell, ...tailCells] as any[];
      });
      autoTable(doc, {
        startY: topPad + boardBarHeight,
        head: [header],
        body: rows,
        showHead: "everyPage",
        theme: "grid",
        tableWidth: usableTableWidthPt,
        margin: { left: sidePad, right: sidePad, top: topPad + boardBarHeight, bottom: 24 },
        styles: {
          fontSize: 7,
          cellPadding: 3,
          textColor: [15, 23, 42],
          lineColor: [17, 17, 17],
          lineWidth: 0.5,
          fillColor: rowBaseRgb,
          valign: "middle",
          overflow: "linebreak",
        },
        tableLineWidth: 0,
        headStyles: {
          fillColor: themeRgb,
          textColor: headerTextRgb,
          fontStyle: "bold",
          lineColor: [17, 17, 17],
          lineWidth: 0.7,
          halign: "center",
        },
        columnStyles: Object.fromEntries(
          header.map((name, colIdx) => [
            colIdx,
            (() => {
              const style: { halign: "left" | "center"; cellWidth?: number; cellPadding?: number } = {
                halign: centeredCols.has(name) ? "center" : "left",
              };
              const fixed = globalColumnWidthPtByHeader[name];
              if (fixed) {
                style.cellWidth = fixed;
              }
              if (name === "Height" || name === "Width" || name === "Depth" || name === "Qty" || name === "Clashing" || name === "Grain") {
                style.cellPadding = 1;
              }
              return style;
            })(),
          ]),
        ),
        didParseCell: (hookData) => {
          const colIndex = hookData.column.index;
          const lastCol = header.length - 1;

          if (hookData.section === "head") {
            hookData.cell.styles.lineColor = blackRgb;
            hookData.cell.styles.lineWidth = {
              top: 0,
              right: 0.5,
              bottom: 0.9,
              left: 0.5,
            } as any;
            if (colIndex === 0) {
              // outer border drawn separately to keep rounded corners clean
              (hookData.cell.styles.lineWidth as any).left = 0;
            }
            if (colIndex === lastCol) {
              // outer border drawn separately to keep rounded corners clean
              (hookData.cell.styles.lineWidth as any).right = 0;
            }
            return;
          }

          if (hookData.section !== "body") return;

          const rowBg = rowBgByIndex[hookData.row.index] ?? rowBaseRgb;
          const isLastBodyRow = hookData.row.index === hookData.table.body.length - 1;
          // Last row background is painted once as a rounded row in willDrawCell.
          // Keep edge cells transparent so corners remain rounded.
          hookData.cell.styles.fillColor = (isLastBodyRow && (colIndex === 0 || colIndex === lastCol)) ? (false as any) : rowBg;
          hookData.cell.styles.lineColor = blackRgb;
          hookData.cell.styles.lineWidth = {
            top: 0,
            right: 0.5,
            bottom: isLastBodyRow ? 0 : 0,
            left: 0,
          } as any;
          if (colIndex === 0) {
            // outer border drawn separately to keep rounded corners clean
            (hookData.cell.styles.lineWidth as any).left = 0;
          }
          if (colIndex === lastCol) {
            // outer border drawn separately to keep rounded corners clean
            (hookData.cell.styles.lineWidth as any).right = 0;
          }

          if (colIndex === 4 || colIndex === 5 || colIndex === 6) {
            const row = group.rows[hookData.row.index];
            if (row) {
              const boardHasGrain = boardGrainFor(String(row.board || "").trim());
              const grainValue = String(row.grainValue ?? "");
              const isMatch =
                boardHasGrain && (
                  (colIndex === 4 && matchesGrainDimension(grainValue, String(row.height ?? ""), "height")) ||
                  (colIndex === 5 && matchesGrainDimension(grainValue, String(row.width ?? ""), "width")) ||
                  (colIndex === 6 && matchesGrainDimension(grainValue, String(row.depth ?? ""), "depth"))
                );
              if (isMatch) {
                hookData.cell.styles.fontStyle = "bold";
              }
            }
          }

          if (colIndex !== 2) return;
          const raw = hookData.cell.raw as any;
          const partType = String((raw && typeof raw === "object" && "content" in raw) ? raw.content : raw ?? "").trim();
          const partHex =
            normalizeHexColor(partTypeColors[partType] ?? partTypeColors[partType.toLowerCase()] ?? "") ?? null;
          if (!partHex) return;
          const partRgb = toRgb(partHex);
          hookData.cell.styles.fillColor = partRgb;
          hookData.cell.styles.textColor = isLightHex(partHex) ? [15, 23, 42] : [255, 255, 255];
        },
        willDrawCell: (hookData) => {
          if (hookData.section !== "body") return;
          const isLastBodyRow = hookData.row.index === hookData.table.body.length - 1;
          if (!isLastBodyRow || hookData.column.index !== 0) return;
          const rowBg = rowBgByIndex[hookData.row.index] ?? rowBaseRgb;
          const rowX = hookData.cell.x;
          const rowY = hookData.cell.y;
          const rowH = hookData.cell.height;
          const rowW = usableTableWidthPt;
          const r = 7;
          doc.setFillColor(rowBg[0], rowBg[1], rowBg[2]);
          doc.roundedRect(rowX, rowY, rowW, rowH, r, r, "F");
          // Square top edge only so bottom outside corners stay rounded.
          doc.rect(rowX, rowY, rowW, Math.max(0, rowH - r), "F");
        },
        didDrawCell: (hookData) => {
          if (hookData.section !== "body") return;
          const colIndex = hookData.column.index;
          if (colIndex !== 4 && colIndex !== 5 && colIndex !== 6) return;
          const row = group.rows[hookData.row.index];
          if (!row) return;
          const boardHasGrain = boardGrainFor(String(row.board || "").trim());
          if (!boardHasGrain) return;
          const grainValue = String(row.grainValue ?? "");
          const isMatch =
            (colIndex === 4 && matchesGrainDimension(grainValue, String(row.height ?? ""), "height")) ||
            (colIndex === 5 && matchesGrainDimension(grainValue, String(row.width ?? ""), "width")) ||
            (colIndex === 6 && matchesGrainDimension(grainValue, String(row.depth ?? ""), "depth"));
          if (!isMatch) return;
          const rawVal = colIndex === 4 ? row.height : colIndex === 5 ? row.width : row.depth;
          const text = String(rawVal ?? "").trim();
          if (!text) return;
          hookData.cell.styles.fontStyle = "bold";
          const textW = doc.getTextWidth(text);
          const centerX = hookData.cell.x + hookData.cell.width / 2;
          const textX = centerX - textW / 2;
          const underlineY = hookData.cell.y + hookData.cell.height * 0.66;
          doc.setDrawColor(15, 23, 42);
          doc.setLineWidth(0.6);
          doc.line(textX, underlineY, textX + textW, underlineY);
        },
        didDrawPage: () => {
          const boardBarW = pageWidth - sidePad * 2;
          doc.setFillColor(17, 17, 17);
          doc.roundedRect(sidePad, topPad, boardBarW, boardBarHeight, 7, 7, "F");
          // Square the bottom corners while keeping only top corners rounded.
          doc.rect(sidePad, topPad + 7, boardBarW, Math.max(0, boardBarHeight - 7), "F");
          doc.setTextColor(255, 255, 255);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.text(String(group.boardLabel || "Board"), sidePad + 8, topPad + 14);
          if (boardGrainFor(group.boardKey)) {
            doc.setFontSize(8);
            doc.setFont("helvetica", "bold");
            const helperWordW = doc.getTextWidth(helperWord);
            doc.setFont("helvetica", "normal");
            const helperTailW = doc.getTextWidth(helperTail);
            const helperTotalW = helperWordW + helperTailW;
            const helperStartX = sidePad + boardBarW - 8 - helperTotalW;
            const helperY = topPad + 14;
            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.text(helperWord, helperStartX, helperY);
            doc.setDrawColor(255, 255, 255);
            doc.setLineWidth(0.6);
            doc.line(helperStartX, helperY + 1, helperStartX + helperWordW, helperY + 1);
            doc.setFont("helvetica", "normal");
            doc.text(helperTail, helperStartX + helperWordW, helperY);
          }
        },
      });
      const lastAuto = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable;
      const finalY = Math.max(topPad + boardBarHeight + 10, Number(lastAuto?.finalY ?? 0));
      // Draw table column dividers last using deterministic layout widths.
      const dividerTop = topPad + boardBarHeight;
      if (finalY > dividerTop) {
        doc.setDrawColor(17, 17, 17);
        doc.setLineWidth(0.7);
        let x = sidePad;
        for (let c = 0; c < header.length - 1; c += 1) {
          x += Number(globalColumnWidthPtByHeader[header[c]] ?? 0);
          doc.line(x, dividerTop, x, finalY);
        }
      }
      const sectionH = finalY - topPad;
      const cornerRadius = 7;
      const tableW = pageWidth - sidePad * 2;
      doc.setDrawColor(17, 17, 17);
      doc.setLineWidth(0.7);
      doc.roundedRect(sidePad, topPad, tableW, sectionH, cornerRadius, cornerRadius, "S");
    });

    if (cncCabinetCards.length > 0) {
      const drawCabinetsPageHeader = () => {
        const barW = pageWidth - sidePad * 2;
        doc.setFillColor(17, 17, 17);
        doc.roundedRect(sidePad, topPad, barW, boardBarHeight, 7, 7, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text("Cabinets", sidePad + 8, topPad + 14);
        if (anyBoardHasGrain) {
          doc.setFontSize(8);
          doc.setFont("helvetica", "bold");
          const helperWordW = doc.getTextWidth(helperWord);
          doc.setFont("helvetica", "normal");
          const helperTailW = doc.getTextWidth(helperTail);
          const helperTotalW = helperWordW + helperTailW;
          const helperStartX = sidePad + barW - 8 - helperTotalW;
          const helperY = topPad + 14;
          doc.setTextColor(255, 255, 255);
          doc.setFont("helvetica", "bold");
          doc.text(helperWord, helperStartX, helperY);
          doc.setDrawColor(255, 255, 255);
          doc.setLineWidth(0.6);
          doc.line(helperStartX, helperY + 1, helperStartX + helperWordW, helperY + 1);
          doc.setFont("helvetica", "normal");
          doc.text(helperTail, helperStartX + helperWordW, helperY);
        }
      };
      doc.addPage();
      drawCabinetsPageHeader();
      let y = topPad + boardBarHeight + 8;
      const cardGap = 10;
      const cardX = sidePad;
      const cardW = pageWidth - sidePad * 2;
      const headerH = 22;
      const bodyPad = 8;
      const imageColW = 165;
      for (const card of cncCabinetCards) {
        const topBottomPiece = card.cabinetryPieces.top ?? card.cabinetryPieces.bottom;
        const leftRightPiece = card.cabinetryPieces.left_side ?? card.cabinetryPieces.right_side;
        const backPiece = card.cabinetryPieces.back;
        const fixedPiece = card.cabinetryPieces.fixed_shelf;
        const adjustablePiece = card.cabinetryPieces.adjustable_shelf;
        const infoLines = card.infoLines.length ? card.infoLines : [""];
        const contentLineH = 12;
        const detailRowH = 18;
        const rowsH = 5 * detailRowH;
        // Information row matches normal row height by default, and grows only for extra lines.
        const infoRowBaseH = detailRowH;
        const infoRowExtraH = Math.max(0, infoLines.length - 1) * contentLineH;
        const infoRowH = infoRowBaseH + infoRowExtraH;
        const bodyH = Math.max(130, rowsH + infoRowH);
        const cardH = headerH + bodyH;
        if (y + cardH > pageHeight - 20) {
          doc.addPage();
          drawCabinetsPageHeader();
          y = topPad + boardBarHeight + 8;
        }
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(cardX, y, cardW, cardH, 6, 6, "F");
        doc.setFillColor(245, 248, 252);
        doc.roundedRect(cardX, y, cardW, headerH, 6, 6, "F");
        // Keep only top corners rounded on the title bar fill.
        doc.rect(cardX, y + 6, cardW, Math.max(0, headerH - 6), "F");
        doc.setFont("helvetica", "normal");
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(9);
        doc.text(String(card.displayId), cardX + 20, y + headerH / 2 + 3, { align: "center" });
        doc.setFont("helvetica", "bold");
        doc.text(String(card.row.name || "-"), cardX + 48, y + 14);

        const bodyY = y + headerH;
        const imageX = cardX + bodyPad;
        const imageY = bodyY + bodyPad;
        const imageW = imageColW - bodyPad * 2;
        const imageH = bodyH - bodyPad * 2;
        const detailX = cardX + imageColW;
        const detailW = cardW - imageColW;

        const colGap = 10;
        const leftColX = detailX + bodyPad;
        const rightColX = detailX + detailW / 2 + colGap / 2;
        const colW = detailW / 2 - bodyPad - colGap / 2;
        const drawDimRun = (
          x: number,
          baselineY: number,
          height: string,
          width: string,
          depth: string,
          grainValue: string,
          qtySuffix = "",
        ) => {
          const parts: Array<{ key: "height" | "width" | "depth"; value: string }> = [];
          const h = String(height || "").trim();
          const w = String(width || "").trim();
          const d = String(depth || "").trim();
          if (h) parts.push({ key: "height", value: h });
          if (w) parts.push({ key: "width", value: w });
          if (d) parts.push({ key: "depth", value: d });
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          let cx = x;
          parts.forEach((part, idx) => {
            if (idx > 0) {
              const sep = " x ";
              doc.text(sep, cx, baselineY);
              cx += doc.getTextWidth(sep);
            }
            const isMatch = matchesGrainDimension(grainValue, part.value, part.key);
            doc.setFont("helvetica", isMatch ? "bold" : "normal");
            doc.text(part.value, cx, baselineY);
            const wPart = doc.getTextWidth(part.value);
            if (isMatch) {
              doc.setDrawColor(15, 23, 42);
              doc.setLineWidth(0.6);
              doc.line(cx, baselineY + 1, cx + wPart, baselineY + 1);
            }
            cx += wPart;
          });
          if (qtySuffix) {
            doc.setFont("helvetica", "normal");
            doc.text(qtySuffix, cx, baselineY);
          }
        };
        const drawKv = (x: number, rowTop: number, rowH: number, key: string, value: string) => {
          const baselineY = rowTop + rowH / 2 + 3;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text(key, x, baselineY);
          doc.setFont("helvetica", "normal");
          const wrapped = doc.splitTextToSize(String(value || ""), Math.max(10, colW - 90));
          doc.text(wrapped, x + 88, baselineY);
        };
        const detailsTop = bodyY;
        drawKv(leftColX, detailsTop + detailRowH * 0, detailRowH, "Material", card.boardLabel || "-");
        drawKv(leftColX, detailsTop + detailRowH * 1, detailRowH, "Quantity", String(card.row.quantity || ""));
        drawKv(leftColX, detailsTop + detailRowH * 2, detailRowH, "Size (H x W x D)", "");
        drawDimRun(
          leftColX + 88,
          detailsTop + detailRowH * 2 + detailRowH / 2 + 3,
          String(card.row.height ?? ""),
          String(card.row.width ?? ""),
          String(card.row.depth ?? ""),
          String(card.row.grainValue ?? ""),
        );
        drawKv(leftColX, detailsTop + detailRowH * 3, detailRowH, card.fixedShelf === 1 ? "Fixed Shelf" : "Fixed Shelves", card.fixedShelf > 0 ? `${card.fixedShelf} (${String(normalizeDrillingValue(card.row.fixedShelfDrilling || "No")).toLowerCase()} drilling)` : "");
        drawKv(leftColX, detailsTop + detailRowH * 4, detailRowH, card.adjustableShelf === 1 ? "Adjustable Shelf" : "Adjustable Shelves", card.adjustableShelf > 0 ? `${card.adjustableShelf} (${String(normalizeDrillingValue(card.row.adjustableShelfDrilling || "No")).toLowerCase()} drilling)` : "");

        drawKv(rightColX, detailsTop + detailRowH * 0, detailRowH, "Top / Bottom", "");
        if (topBottomPiece) {
          const qty = Number.parseInt(String(topBottomPiece.quantity || "0"), 10) || 0;
          drawDimRun(
            rightColX + 88,
            detailsTop + detailRowH * 0 + detailRowH / 2 + 3,
            String(topBottomPiece.height ?? ""),
            String(topBottomPiece.width ?? ""),
            String(topBottomPiece.depth ?? ""),
            cabinetryPieceGrainValue(card.row, topBottomPiece),
            qty > 0 ? ` (x${qty * 2})` : "",
          );
        }
        drawKv(rightColX, detailsTop + detailRowH * 1, detailRowH, "Left / Right Side", "");
        if (leftRightPiece) {
          const qty = Number.parseInt(String(leftRightPiece.quantity || "0"), 10) || 0;
          drawDimRun(
            rightColX + 88,
            detailsTop + detailRowH * 1 + detailRowH / 2 + 3,
            String(leftRightPiece.height ?? ""),
            String(leftRightPiece.width ?? ""),
            String(leftRightPiece.depth ?? ""),
            cabinetryPieceGrainValue(card.row, leftRightPiece),
            qty > 0 ? ` (x${qty * 2})` : "",
          );
        }
        drawKv(rightColX, detailsTop + detailRowH * 2, detailRowH, "Back", "");
        if (backPiece) {
          const qty = Number.parseInt(String(backPiece.quantity || "0"), 10) || 0;
          drawDimRun(
            rightColX + 88,
            detailsTop + detailRowH * 2 + detailRowH / 2 + 3,
            String(backPiece.height ?? ""),
            String(backPiece.width ?? ""),
            String(backPiece.depth ?? ""),
            cabinetryPieceGrainValue(card.row, backPiece),
            qty > 0 ? ` (x${qty})` : "",
          );
        }
        drawKv(rightColX, detailsTop + detailRowH * 3, detailRowH, "Fixed Shelf", "");
        if (fixedPiece) {
          const qty = Number.parseInt(String(fixedPiece.quantity || "0"), 10) || 0;
          drawDimRun(
            rightColX + 88,
            detailsTop + detailRowH * 3 + detailRowH / 2 + 3,
            String(fixedPiece.height ?? ""),
            String(fixedPiece.width ?? ""),
            String(fixedPiece.depth ?? ""),
            cabinetryPieceGrainValue(card.row, fixedPiece),
            qty > 0 ? ` (x${qty})` : "",
          );
        }
        drawKv(rightColX, detailsTop + detailRowH * 4, detailRowH, "Adjustable Shelf", "");
        if (adjustablePiece) {
          const qty = Number.parseInt(String(adjustablePiece.quantity || "0"), 10) || 0;
          drawDimRun(
            rightColX + 88,
            detailsTop + detailRowH * 4 + detailRowH / 2 + 3,
            String(adjustablePiece.height ?? ""),
            String(adjustablePiece.width ?? ""),
            String(adjustablePiece.depth ?? ""),
            cabinetryPieceGrainValue(card.row, adjustablePiece),
            qty > 0 ? ` (x${qty})` : "",
          );
        }

        // Row partitions between cabinet detail rows.
        const detailRowsStartY = detailsTop;
        doc.setDrawColor(228, 231, 238);
        doc.setLineWidth(0.5);
        for (let i = 1; i <= 4; i += 1) {
          const lineY = detailRowsStartY + i * detailRowH;
          doc.line(detailX, lineY, cardX + cardW, lineY);
        }

        const infoRowTop = detailRowsStartY + rowsH;
        const infoStartY = infoRowTop + infoRowBaseH / 2 + 3;
        doc.setDrawColor(228, 231, 238);
        doc.line(detailX, infoRowTop, cardX + cardW, infoRowTop);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(15, 23, 42);
        doc.text("Information", leftColX, infoStartY);
        doc.setFont("helvetica", "normal");
        doc.text(infoLines, leftColX + 88, infoStartY);

        const cacheKey = cabinetPdfImageKey(card);
        const cached = cabinetPdfImageCacheRef.current[cacheKey];
        if (cached?.url) {
          const ratio = cached.svgW / Math.max(1, cached.svgH);
          const targetW = imageW - 12;
          const targetH = imageH - 12;
          let drawW = targetW;
          let drawH = targetW / ratio;
          if (drawH > targetH) {
            drawH = targetH;
            drawW = drawH * ratio;
          }
          const drawX = imageX + (imageW - drawW) / 2;
          const drawY = imageY + (imageH - drawH) / 2;
          doc.addImage(cached.url, "PNG", drawX, drawY, drawW, drawH);
        }

        // Draw black card borders/major dividers last so they stay visually consistent.
        const idDividerX = cardX + 40;
        doc.setDrawColor(17, 17, 17);
        doc.setLineWidth(0.7);
        doc.roundedRect(cardX, y, cardW, cardH, 6, 6, "S");
        doc.line(idDividerX, y, idDividerX, y + headerH);
        doc.line(cardX, y + headerH, cardX + cardW, y + headerH);
        doc.line(detailX, bodyY, detailX, bodyY + bodyH);
        y += cardH + cardGap;
      }
    }

    const pdfBlob = doc.output("blob");
    const url = URL.createObjectURL(pdfBlob);
    if (mode === "print") {
      const printWindow = window.open(url, "_blank");
      if (printWindow) {
        const triggerPrint = () => {
          try {
            printWindow.focus();
            printWindow.print();
          } catch {
            // no-op
          }
        };
        printWindow.addEventListener("load", triggerPrint, { once: true });
        window.setTimeout(triggerPrint, 500);
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 120000);
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2500);
  };

  if (isOrderFullscreen) {
    return (
      <ProtectedRoute>
        <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--bg-app)]">
          <div className="sticky top-0 z-[95] flex h-[56px] shrink-0 items-center justify-between border-b border-[#D7DEE8] bg-white px-4 md:px-5">
            <div className="inline-flex items-center gap-2 text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">
              <ShoppingCart size={14} />
              <span>Order</span>
              <span className="text-[#6B7280]">|</span>
              <span className="truncate text-[#334155]">{project?.name || "Project"}</span>
            </div>
            <button
              type="button"
              onClick={() => void onSaveAndBackFromOrder()}
              className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#C8DAFF] bg-[#EAF1FF] px-3 text-[12px] font-bold text-[#24589A] hover:bg-[#DFE9FF]"
            >
              <ArrowLeft size={14} />
              Save & Back
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
            <div className="flex h-full min-h-[calc(100dvh-120px)] flex-col gap-3">
              <div className="grid min-h-0 flex-1 gap-3">
                <div className="grid min-h-0 gap-3 xl:grid-cols-3">
                  <section className="flex h-[420px] min-h-0 flex-col overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                    <div className="flex h-[46px] items-center justify-between border-b border-[#DCE3EC] bg-[#F8FAFC] px-4">
                      <p className="text-[13px] font-medium uppercase tracking-[1px] text-[#12345B]">Drawers</p>
                      <div className="inline-flex items-center gap-2">
                        <span className="rounded-[999px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[1px] text-[11px] font-bold text-[#3A506F]">
                          {orderDrawerGroupedRows.length} Groups
                        </span>
                        <span className="rounded-[999px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[1px] text-[11px] font-bold text-[#3A506F]">
                          {orderDrawerQtyTotal} Qty
                        </span>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      {orderDrawerGroupedRows.length === 0 ? (
                        <p className="px-3 py-6 text-center text-[12px] font-semibold text-[#64748B]">No drawer rows.</p>
                      ) : (
                        <table className="w-full text-left text-[12px]">
                          <thead className="bg-[#EAF2FD] text-[#0F172A]">
                            <tr>
                              <th className="px-3 py-2">Hardware</th>
                              <th className="px-2 py-2">Drawer Type</th>
                              <th className="px-2 py-2 text-center">Length</th>
                              <th className="px-2 py-2 text-center">Back Height</th>
                              <th className="px-2 py-2 text-center">Qty</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orderDrawerGroupedRows.map((group, idx) => (
                              <tr key={`order_drawer_row_${group.key}`} className={`${idx % 2 ? "bg-[#F8FAFD]" : "bg-white"} border-t border-[#E4E7EE]`}>
                                <td className="px-3 py-[7px] font-semibold text-[#1F2937]">{group.hardware || "-"}</td>
                                <td className="px-2 py-[7px] font-semibold text-[#1F2937]">{group.drawerType || "-"}</td>
                                <td className="px-2 py-[7px] text-center text-[#334155]">{group.hardwareLength || "-"}</td>
                                <td className="px-2 py-[7px] text-center text-[#334155]">{group.backHeight || "-"}</td>
                                <td className="px-2 py-[7px] text-center font-bold text-[#0F172A]">{group.total}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </section>

                  <section className="flex h-[420px] min-h-0 flex-col overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                    <div className="flex h-[46px] items-center justify-between border-b border-[#DCE3EC] bg-[#F8FAFC] px-4">
                      <p className="text-[13px] font-medium uppercase tracking-[1px] text-[#12345B]">Hinges</p>
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={onAddOrderHingeRow}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-[#A9DDBF] bg-[#EAF8F0] text-[16px] font-bold leading-none text-[#1F8A4C] hover:bg-[#DDF2E7]"
                          title="Add hinge row"
                        >
                          <img
                            src="/plus.png"
                            alt="Add hinge row"
                            className="block object-contain"
                            style={{ width: 17, height: 17, filter: "invert(38%) sepia(31%) saturate(1592%) hue-rotate(101deg) brightness(94%) contrast(80%)" }}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      {orderHingeRows.length === 0 ? (
                        <p className="px-3 py-6 text-center text-[12px] font-semibold text-[#64748B]">No hinge rows.</p>
                      ) : (
                        <table className="w-full text-left text-[12px]">
                          <thead className="bg-[#EAF2FD] text-[#0F172A]">
                            <tr>
                              <th className="w-[38px] px-0 py-2 text-center"></th>
                              <th className="px-3 py-2">Hinge Type</th>
                              <th className="px-2 py-2 text-center">Qty</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orderHingeRows.map((line, idx) => (
                              <tr key={`order_hw_${line.id}`} className={`${idx % 2 ? "bg-[#F8FAFD]" : "bg-white"} border-t border-[#E4E7EE]`}>
                                <td className="w-[38px] px-0 py-[7px] text-center align-middle">
                                  <button
                                    type="button"
                                    onClick={() => void onDeleteOrderHingeRow(line.id)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[11px] font-bold text-[#C62828] disabled:opacity-55"
                                    title="Delete row"
                                  >
                                    <X size={15} className="mx-auto" strokeWidth={2.8} />
                                  </button>
                                </td>
                                <td className="px-3 py-[7px]">
                                  <select
                                    value={line.name}
                                    onChange={(e) => void onOrderHingeTypeChange(line.id, e.target.value)}
                                    className="h-7 w-full rounded-[8px] border border-[#CBD5E1] bg-white px-2 text-[12px] font-semibold text-[#1F2937] outline-none focus:border-[#93C5FD]"
                                  >
                                    <option value=""></option>
                                    {orderHingeOptions.map((opt) => (
                                      <option key={`order_hinge_opt_${opt}`} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-2 py-[7px] text-center">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={line.qty ?? ""}
                                    onChange={(e) => onUpdateOrderHingeRow(line.id, { qty: e.target.value.replace(/\D+/g, "") })}
                                    onBlur={(e) => void onOrderHingeQtyBlur(line.id, e.target.value.replace(/\D+/g, ""))}
                                    className="h-7 w-[68px] rounded-[8px] border border-[#CBD5E1] bg-white px-2 text-center text-[12px] font-bold text-[#0F172A] outline-none focus:border-[#93C5FD]"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </section>

                  <section className="flex h-[420px] min-h-0 flex-col overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                    <div className="flex h-[46px] items-center justify-between border-b border-[#DCE3EC] bg-[#F8FAFC] px-4">
                      <p className="text-[13px] font-medium uppercase tracking-[1px] text-[#12345B]">Misc.</p>
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void onAddOrderMiscRow()}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-[#A9DDBF] bg-[#EAF8F0] hover:bg-[#DDF2E7]"
                          title="Add misc row"
                        >
                          <img
                            src="/plus.png"
                            alt="Add misc row"
                            className="block object-contain"
                            style={{ width: 17, height: 17, filter: "invert(38%) sepia(31%) saturate(1592%) hue-rotate(101deg) brightness(94%) contrast(80%)" }}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      {orderMiscLines.length === 0 ? (
                        <p className="px-3 py-6 text-center text-[12px] font-semibold text-[#64748B]">No misc rows.</p>
                      ) : (
                        <table className="w-full table-fixed text-left text-[12px]">
                          <colgroup>
                            <col style={{ width: "38px" }} />
                            <col />
                            <col style={{ width: "50%" }} />
                            <col style={{ width: "84px" }} />
                          </colgroup>
                          <thead className="bg-[#EAF2FD] text-[#0F172A]">
                            <tr>
                              <th className="px-0 py-2 text-center"></th>
                              <th className="px-3 py-2">Misc Item</th>
                              <th className="px-2 py-2">Notes</th>
                              <th className="px-2 py-2 text-center">Qty</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orderMiscLines.map((line, idx) => (
                              <tr key={`order_misc_${line.key}`} className={`${idx % 2 ? "bg-[#F8FAFD]" : "bg-white"} border-t border-[#E4E7EE]`}>
                                <td className="w-[38px] px-0 py-[7px] text-center align-middle">
                                  <button
                                    type="button"
                                    onClick={() => void onDeleteOrderMiscRow(line.key)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[11px] font-bold text-[#C62828] disabled:opacity-55"
                                    title="Delete row"
                                  >
                                    <X size={15} className="mx-auto" strokeWidth={2.8} />
                                  </button>
                                </td>
                                <td className="px-3 py-[7px]">
                                  <input
                                    type="text"
                                    value={line.name ?? ""}
                                    onChange={(e) => onOrderMiscDraftChange(line.key, { name: e.target.value })}
                                    onBlur={(e) => void onOrderMiscDraftBlur(line.key, { name: e.target.value })}
                                    className="h-7 w-full rounded-[8px] border border-[#CBD5E1] bg-white px-2 text-[12px] font-semibold text-[#1F2937] outline-none focus:border-[#93C5FD]"
                                  />
                                </td>
                                <td className="px-2 py-[7px]">
                                  <input
                                    type="text"
                                    value={line.notes ?? ""}
                                    onChange={(e) => onOrderMiscDraftChange(line.key, { notes: e.target.value })}
                                    onBlur={(e) => void onOrderMiscDraftBlur(line.key, { notes: e.target.value })}
                                    className="h-7 w-full rounded-[8px] border border-[#CBD5E1] bg-white px-2 text-[12px] text-[#1F2937] outline-none focus:border-[#93C5FD]"
                                  />
                                </td>
                                <td className="px-2 py-[7px] text-center">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={line.qty ?? ""}
                                    onChange={(e) => onOrderMiscDraftChange(line.key, { qty: e.target.value.replace(/\D+/g, "") })}
                                    onBlur={(e) => void onOrderMiscDraftBlur(line.key, { qty: e.target.value.replace(/\D+/g, "") })}
                                    className="h-7 w-[68px] rounded-[8px] border border-[#CBD5E1] bg-white px-2 text-center text-[12px] font-bold text-[#0F172A] outline-none focus:border-[#93C5FD]"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </section>
                </div>

                <section className="min-h-0 overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                  <div className="flex h-[46px] items-center justify-between border-b border-[#DCE3EC] bg-[#F8FAFC] px-4">
                    <p className="text-[13px] font-medium uppercase tracking-[1px] text-[#12345B]">Boards To Order</p>
                    <div className="inline-flex items-center gap-2">
                      <span className="rounded-[999px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[1px] text-[11px] font-bold text-[#3A506F]">
                        {orderBoardSummary.length} Rows
                      </span>
                      <span className="rounded-[999px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[1px] text-[11px] font-bold text-[#3A506F]">
                        {formatPartCount(cutlistRows.length)}
                      </span>
                      <span className="rounded-[999px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[1px] text-[11px] font-bold text-[#3A506F]">
                        {orderTotalSheetsRequired} Sheets
                      </span>
                    </div>
                  </div>
                  <div className="max-h-[calc(100dvh-180px)] overflow-auto">
                    <table className="w-full text-left text-[12px]">
                      <thead className="bg-[#FDF1C9] text-[#0F172A]">
                        <tr>
                          <th className="px-3 py-2">Board</th>
                          <th className="px-2 py-2 text-center">Size</th>
                          <th className="px-2 py-2 text-center">Thickness</th>
                          <th className="px-2 py-2 text-center">Finish</th>
                          <th className="px-2 py-2 text-center">Sheets</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderBoardSummary.map((row, idx) => (
                          <tr key={`order_board_full_${row.id}`} className={`${idx % 2 ? "bg-[#F8FAFD]" : "bg-white"} border-t border-[#E4E7EE]`}>
                            <td className="px-3 py-[7px] font-semibold text-[#1F2937]">{row.boardLabel}</td>
                            <td className="px-2 py-[7px] text-center text-[#334155]">{row.boardSize}</td>
                            <td className="px-2 py-[7px] text-center text-[#334155]">{row.thickness}</td>
                            <td className="px-2 py-[7px] text-center text-[#334155]">{row.finish}</td>
                            <td className="px-2 py-[7px] text-center">
                              <span className="inline-flex min-w-[28px] justify-center rounded-[8px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[1px] font-bold text-[#2F4E68]">
                                {row.sheetsRequired}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {orderBoardSummary.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-3 py-8 text-center text-[12px] font-semibold text-[#64748B]">
                              No board order data yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

              </div>
            </div>
          </div>
          {addRoomModalPortal}
        </div>
      </ProtectedRoute>
    );
  }

  if (isSalesInitialFullscreen) {
    return (
      <ProtectedRoute>
        <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--bg-app)]">
          <div className="sticky top-0 z-[95] flex h-[56px] shrink-0 items-center justify-between border-b border-[#D7DEE8] bg-white px-4 md:px-5">
            <div className="inline-flex items-center gap-2 text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">
              <Ruler size={14} />
              <span>Initial Measure</span>
              <span className="text-[#6B7280]">|</span>
              <span className="truncate text-[#334155]">{project?.name || "Project"}</span>
            </div>
            <button
              type="button"
              onClick={() => setSalesNav("items")}
              className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#C8DAFF] bg-[#EAF1FF] px-3 text-[12px] font-bold text-[#24589A] hover:bg-[#DFE9FF]"
            >
              <ArrowLeft size={14} />
              Save & Back
            </button>
          </div>
          <div className="shrink-0 overflow-hidden border-b border-[#DCE3EC] bg-white px-3 py-1">
            <div
              ref={cutlistActivityScrollRef}
              className="w-full max-w-full min-w-0 overflow-hidden whitespace-nowrap"
              dir="ltr"
              style={{ userSelect: "none", touchAction: "none" }}
              onDragStart={(e) => e.preventDefault()}
            >
              <div
                ref={cutlistActivityInnerRef}
                className="inline-flex w-max cursor-grab items-center gap-[10px] pr-2"
                dir="ltr"
                style={{
                  userSelect: "none",
                  touchAction: "none",
                  transform: `translate3d(${cutlistActivityOffset}px, 0, 0)`,
                  willChange: "transform",
                  transition: cutlistActivityIsDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
                onPointerDown={onCutlistActivityPointerDown}
                onPointerUp={endCutlistActivityPointerDrag}
                onPointerCancel={endCutlistActivityPointerDrag}
              >
                {initialCutlistActivityFeed.map((entry, idx) => {
                  const colors = activityColorsForPart(entry.partType || "", entry.actionKind || "");
                  const isPartTypeMove = Boolean(entry.partType && entry.partTypeTo);
                  const isValueMove = Boolean(entry.valueFrom || entry.valueTo);
                  const isEntering = Boolean(cutlistActivityEnteringIds[entry.id]);
                  const rawMessage = String(entry.message || "");
                  const messageLower = rawMessage.toLowerCase();
                  let messagePrefix = rawMessage;
                  let actionText = "";
                  let messageSuffix = "";
                  if (!isPartTypeMove && !isValueMove) {
                    const addedToken = " added to ";
                    const addedIdx = messageLower.indexOf(addedToken);
                    if (addedIdx > 0) {
                      messagePrefix = rawMessage.slice(0, addedIdx).trim();
                      actionText = "added to";
                      messageSuffix = rawMessage.slice(addedIdx + addedToken.length).trim();
                    } else if (messageLower.endsWith(" removed")) {
                      messagePrefix = rawMessage.slice(0, rawMessage.length - " removed".length).trim();
                      actionText = "removed";
                      messageSuffix = "";
                    }
                  }
                  return (
                    <div
                      key={entry.id}
                      className="inline-flex items-center gap-[10px] rounded-[9px] border px-2 py-[2px]"
                      style={{
                        backgroundColor: colors.chipBg,
                        borderColor: colors.chipBorder,
                        marginRight: idx < initialCutlistActivityFeed.length - 1 ? 10 : 0,
                        opacity: isEntering ? 0 : 1,
                        transform: isEntering ? "translate3d(12px,0,0)" : "translate3d(0,0,0)",
                        transition: "opacity 240ms ease, transform 240ms ease",
                      }}
                    >
                      {!!messagePrefix && !!actionText && (
                        <span
                          className="inline-flex h-[18px] items-center rounded-[8px] border px-2 text-[11px] font-bold"
                          style={{
                            backgroundColor: colors.pillBg,
                            borderColor: colors.pillBorder,
                            color: colors.pillText,
                          }}
                        >
                          {messagePrefix}
                        </span>
                      )}
                      {!!messagePrefix && !actionText && (
                        <span className="text-[11px] font-bold" style={{ color: colors.chipText, paddingRight: 5 }}>
                          {messagePrefix}
                        </span>
                      )}
                      {!!actionText && (
                        <span className="text-[11px] font-bold" style={{ color: colors.chipText }}>
                          {actionText}
                        </span>
                      )}
                      {!!messageSuffix && (
                        <span className="text-[11px] font-bold" style={{ color: colors.chipText, paddingLeft: 5 }}>
                          {messageSuffix}
                        </span>
                      )}
                      {isPartTypeMove && !!entry.partType && (
                        <>
                          <span
                            className="inline-flex h-[18px] items-center rounded-[8px] border px-2 text-[11px] font-bold"
                            style={{
                              backgroundColor: colors.pillBg,
                              borderColor: colors.pillBorder,
                              color: colors.pillText,
                            }}
                          >
                            {entry.partType}
                          </span>
                          <span className="inline-flex items-center" style={{ paddingLeft: 5, paddingRight: 5 }}>
                            <img
                              src="/arrow-right.png"
                              alt="to"
                              className="shrink-0 object-contain opacity-90"
                              style={{ width: 20, height: 20 }}
                            />
                          </span>
                        </>
                      )}
                      {isValueMove && !isPartTypeMove && (
                        <>
                          <span
                            className="inline-flex h-[18px] items-center rounded-[8px] border px-2 text-[11px] font-bold"
                            style={{
                              backgroundColor: colors.pillBg,
                              borderColor: colors.pillBorder,
                              color: colors.pillText,
                            }}
                          >
                            {entry.valueFrom || "-"}
                          </span>
                          <span className="inline-flex items-center" style={{ paddingLeft: 5, paddingRight: 5 }}>
                            <img
                              src="/arrow-right.png"
                              alt="to"
                              className="shrink-0 object-contain opacity-90"
                              style={{ width: 20, height: 20 }}
                            />
                          </span>
                        </>
                      )}
                      {!!entry.partTypeTo && (
                        <span
                          className="inline-flex h-[18px] items-center rounded-[8px] border px-2 text-[11px] font-bold"
                          style={{
                            backgroundColor: activityColorsForPart(entry.partTypeTo || "").pillBg,
                            borderColor: activityColorsForPart(entry.partTypeTo || "").pillBorder,
                            color: activityColorsForPart(entry.partTypeTo || "").pillText,
                          }}
                        >
                          {entry.partTypeTo}
                        </span>
                      )}
                      {isValueMove && !isPartTypeMove && (
                        <span
                          className="inline-flex h-[18px] items-center rounded-[8px] border px-2 text-[11px] font-bold"
                          style={{
                            backgroundColor: colors.pillBg,
                            borderColor: colors.pillBorder,
                            color: colors.pillText,
                          }}
                        >
                          {entry.valueTo || "-"}
                        </span>
                      )}
                      {String(entry.actionKind || "") === "clear" && (
                        <button
                          type="button"
                          onClick={() => removeCutlistActivity(entry.id)}
                          data-cutlist-activity-control="true"
                          className="inline-flex h-[18px] items-center rounded-[8px] border border-[#F2A7A7] bg-[#FFECEC] px-2 text-[10px] font-extrabold text-[#991B1B] hover:bg-[#FFDCDC]"
                        >
                          {entry.action || "Clear"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[190px_1fr]">
            <aside className="border-r border-[#DCE3EC] bg-white">
              <div className="flex h-full flex-col p-2">
                <p className="mb-2 px-2 text-[16px] font-medium text-[#111827]">Rooms</p>
                <div className="flex flex-1 flex-col">
                <div className="space-y-1">
                  {initialCutlistAddedRoomTabs.map((roomTab) => {
                    const active = initialCutlistRoomFilter === roomTab.filter;
                    return (
                      <button
                        key={`${roomTab.label}_${roomTab.filter}`}
                        type="button"
                        onClick={() => setInitialCutlistRoomFilter(roomTab.filter)}
                        className={`w-full rounded-[9px] px-2 py-2 text-left text-[12px] font-semibold ${
                          active ? "bg-[#E9EFF7] text-[#12345B]" : "text-[#334155] hover:bg-[#F1F5F9]"
                        }`}
                      >
                        {roomTab.label}
                      </button>
                    );
                  })}
                  <div className="my-2 h-px bg-[#DCE3EC]" />
                  {initialCutlistRoomTabs
                    .filter((tab) => tab.filter === "Project Cutlist")
                    .map((roomTab) => {
                      const active = initialCutlistRoomFilter === roomTab.filter;
                      return (
                        <button
                          key={`${roomTab.label}_${roomTab.filter}`}
                          type="button"
                          onClick={() => setInitialCutlistRoomFilter(roomTab.filter)}
                          className={`w-full rounded-[9px] px-2 py-2 text-left text-[12px] font-semibold ${
                            active ? "bg-[#E9EFF7] text-[#12345B]" : "text-[#334155] hover:bg-[#F1F5F9]"
                          }`}
                        >
                          {roomTab.label}
                        </button>
                      );
                    })}
                  <button
                    type="button"
                    disabled={!salesAccess.edit || isSavingSalesRooms}
                    onClick={() => void onAddCutlistRoom()}
                    className="mt-2 w-full rounded-[9px] border border-[#BFE8CF] bg-[#DDF2E7] px-2 py-2 text-left text-[12px] font-bold text-[#1F6A3B] disabled:opacity-55"
                  >
                    + Add Room
                  </button>
                </div>
                  {initialMeasureLargerSheetWarningsByRoom.length > 0 && (
                    <div className="mt-auto pt-3">
                    <div className="rounded-[10px] border border-[#F2D06B] bg-[#FFF4BF] px-2 py-2 text-[#7A5600]">
                      <div className="flex items-center gap-1">
                        <img
                          src="/danger.png"
                          alt="Warning"
                          className="h-[13px] w-[13px] object-contain"
                          style={{ filter: "brightness(0) saturate(100%) invert(31%) sepia(27%) saturate(1683%) hue-rotate(14deg) brightness(93%) contrast(101%)" }}
                        />
                        <p className="text-[12px] font-semibold">Large sheets used</p>
                      </div>
                      <div className="mt-2 border-t border-[rgba(122,86,0,0.18)] pt-2 space-y-2">
                        {initialMeasureLargerSheetWarningsByRoom.map((roomBlock) => (
                          <div key={`im_warn_full_${roomBlock.room}`} className="border-b border-[rgba(122,86,0,0.18)] pb-2 last:border-b-0 last:pb-0">
                            <p className="text-[10px] font-bold">{roomBlock.room}:</p>
                            <div className="mt-1 space-y-1">
                              {roomBlock.entries.map((entry, idx) => (
                                        <p key={`im_warn_full_${roomBlock.room}_${entry.productName}_${entry.sheetSize}_${idx}`} className="text-[10px] font-medium text-[#8A6A16]">
                                          {entry.productName} {" | "} {entry.sheetSize} {" | "} {entry.sheetCount > 0 ? `${entry.sheetCount}` : ""} {entry.sheetCount === 1 ? "Sheet" : "Sheets"}
                                </p>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t border-[rgba(122,86,0,0.18)] pt-2">
                        <span className="text-[10px] font-semibold">Added to quote</span>
                        <img
                          src={salesRoomSheetAnalysis.largerSheetPricingAddedToQuote ? "/tick.png" : "/cross-small.png"}
                          alt={salesRoomSheetAnalysis.largerSheetPricingAddedToQuote ? "Added to quote" : "Not added to quote"}
                          className="h-4 w-4 object-contain"
                          style={{ filter: salesRoomSheetAnalysis.largerSheetPricingAddedToQuote ? "none" : "brightness(0) saturate(100%) invert(18%) sepia(89%) saturate(2660%) hue-rotate(348deg) brightness(92%) contrast(89%)" }}
                        />
                      </div>
                    </div>
                    </div>
                  )}
                </div>
              </div>
            </aside>

            <div className="flex min-h-full flex-col gap-4 overflow-auto p-4">
              {initialCutlistRoomFilter !== "Project Cutlist" && (
                <section className="relative z-10 -mx-4 w-[calc(100%+2rem)] overflow-visible">
                  <div className="flex h-[50px] items-center px-1">
                    <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Cutlist Entry</p>
                  </div>
                  <div className="space-y-3 px-0 pb-0">
                    <div className="flex flex-wrap items-center gap-2 rounded-[8px] px-1">
                      {initialMeasurePartTypeOptions.map((v) => {
                        const color = partTypeColors[v] ?? "#CBD5E1";
                        return (
                          <button
                            key={`im_pt_full_${v}`}
                            type="button"
                            disabled={salesReadOnly}
                            onClick={() => addInitialDraftRowForPartType(v)}
                            style={{
                              backgroundColor: color,
                              borderColor: color,
                              color: isLightHex(color) ? "#1F2937" : "#F8FAFC",
                            }}
                            className="rounded-[8px] border px-2 py-1 text-[11px] font-medium disabled:opacity-55"
                          >
                            {v}
                          </button>
                        );
                      })}
                    </div>
                    <div className="grid gap-2 text-[11px] font-bold text-[#8A97A8]" style={{ gridTemplateColumns: initialCutlistEntryGridTemplate }}>
                      <p></p>
                      {initialCutlistEntryColumnDefs.map((col) => (
                        <p
                          key={`im_entry_full_header_${col.key}`}
                          className={isCenteredCutlistColumn(col.key) ? "text-center" : ""}
                          style={col.key === "clashing" ? initialCutlistEntryCellStyle("clashing", 2) : initialCutlistEntryCellStyle(col.key)}
                        >
                          {col.key === "clashing" ? (initialDraftEntryShowsShelvesHeader ? "Shelves" : "Clashing") : col.label}
                        </p>
                      ))}
                    </div>
                    <div className="space-y-1">
                      {initialCutlistDraftRows.map((draft) => {
                        const color = partTypeColors[draft.partType] ?? "#CBD5E1";
                        const draftTextColor = isLightHex(color) ? "#1F2937" : "#F8FAFC";
                        const draftFieldBg = lightenHex(color, 0.12);
                        const draftFieldBorder = darkenHex(color, 0.2);
                        const draftIsCabinetry = isCabinetryPartType(draft.partType);
                        const draftBoardAllowsGrain = initialMeasureBoardGrainFor(String(draft.board ?? "").trim());
                        return (
                          <div
                            key={draft.id}
                            className="relative grid items-center gap-2 overflow-visible border-y px-1 py-1"
                            style={{ gridTemplateColumns: initialCutlistEntryGridTemplate, backgroundColor: color, color: draftTextColor, borderColor: draftFieldBorder }}
                          >
                            <button
                              type="button"
                              disabled={salesReadOnly}
                              onClick={() => removeInitialDraftCutlistRow(draft.id)}
                              className="h-8 w-8 rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[11px] font-bold text-[#C62828] disabled:opacity-55"
                            >
                              <X size={15} className="mx-auto" strokeWidth={2.8} />
                            </button>
                            <div className="relative z-[120] pointer-events-auto" style={initialCutlistEntryCellStyle("board")}>
                              <BoardPillDropdown
                                value={draft.board}
                                options={initialMeasureBoardOptions}
                                disabled={salesReadOnly}
                                bg={draftFieldBg}
                                border={draftFieldBorder}
                                text={draftTextColor}
                                getSize={boardSizeFor}
                                getLabel={boardDisplayLabel}
                                onChange={(next) => onInitialDraftBoardChange(draft.id, next)}
                              />
                            </div>
                            <input
                              disabled={salesReadOnly}
                              value={draft.name}
                              onChange={(e) => updateInitialDraftCutlistRow(draft.id, { name: e.target.value })}
                              className="h-8 rounded-[8px] border bg-transparent px-2 text-[12px]"
                              style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor, ...initialCutlistEntryCellStyle("name") }}
                            />
                            {isDrawerPartType(draft.partType) ? (
                              <div style={initialCutlistEntryCellStyle("height")}>
                                <DrawerHeightDropdown
                                  value={String(draft.height || "")}
                                  options={drawerHeightLetterOptions}
                                  disabled={salesReadOnly}
                                  bg={draftFieldBg}
                                  border={draftFieldBorder}
                                  text={draftTextColor}
                                  onAdd={(token) => addInitialDraftDrawerHeightToken(draft.id, token)}
                                  onRemove={(token) => removeInitialDraftDrawerHeightToken(draft.id, token)}
                                />
                              </div>
                            ) : (
                              <input
                                disabled={salesReadOnly}
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={draft.height}
                                onChange={(e) => updateInitialDraftCutlistRow(draft.id, { height: numericOnlyText(e.target.value) })}
                                className="h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center"
                                style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor, ...initialCutlistEntryCellStyle("height") }}
                              />
                            )}
                            <input
                              disabled={salesReadOnly}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={draft.width}
                              onChange={(e) => updateInitialDraftCutlistRow(draft.id, { width: numericOnlyText(e.target.value) })}
                              className="h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center"
                              style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor, ...initialCutlistEntryCellStyle("width") }}
                            />
                            <input
                              disabled={salesReadOnly}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={draft.depth}
                              onChange={(e) => updateInitialDraftCutlistRow(draft.id, { depth: numericOnlyText(e.target.value) })}
                              className="h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center"
                              style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor, ...initialCutlistEntryCellStyle("depth") }}
                            />
                            <input
                              disabled={salesReadOnly || isDrawerPartType(draft.partType)}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={draft.quantity}
                              onChange={(e) => updateInitialDraftCutlistRow(draft.id, { quantity: numericOnlyText(e.target.value) })}
                              className="h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center disabled:opacity-90"
                              style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor, ...initialCutlistEntryCellStyle("quantity") }}
                            />
                            {draftIsCabinetry ? (
                              <div className="grid content-start gap-[1px]" style={initialCutlistEntryCellStyle("clashing", 2)}>
                                <div className="grid content-start gap-0">
                                  <div className="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                    <span className="block pr-[3px] text-right text-[9px] font-bold leading-none" style={{ color: draftTextColor }}>Fixed Shelf</span>
                                    <input
                                      disabled={salesReadOnly}
                                      value={draft.fixedShelf ?? ""}
                                      onChange={(e) => updateInitialDraftCutlistRow(draft.id, { fixedShelf: numericOnlyText(e.target.value) })}
                                      className="h-[18px] w-full min-w-0 rounded-[5px] border bg-transparent px-1 text-[9px]"
                                      style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }}
                                    />
                                  </div>
                                  {hasShelfQuantity(draft.fixedShelf) && (
                                    <div className="-mt-[5px] grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                      <span className="inline-flex w-full items-center justify-end gap-[2px] pr-[3px] text-[9px] font-bold leading-none" style={{ color: draftTextColor }}>
                                        <DrillingArrowIcon color={draftTextColor} />
                                        Drilling
                                      </span>
                                      <div className="w-full min-w-0">
                                        <BoardPillDropdown
                                          value={normalizeDrillingValue(draft.fixedShelfDrilling)}
                                          options={DRILLING_OPTIONS}
                                          disabled={salesReadOnly}
                                          bg={draftFieldBg}
                                          border={draftFieldBorder}
                                          text={draftTextColor}
                                          size="compact"
                                          className="!h-[18px] !rounded-[5px] !text-[9px]"
                                          getSize={() => ""}
                                          getLabel={(v) => v}
                                          onChange={(v) => updateInitialDraftCutlistRow(draft.id, { fixedShelfDrilling: normalizeDrillingValue(v) })}
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div className="grid content-start gap-0">
                                  <div className="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                    <span className="block pr-[3px] text-right text-[9px] font-bold leading-none" style={{ color: draftTextColor }}>Adjustable Shelf</span>
                                    <input
                                      disabled={salesReadOnly}
                                      value={draft.adjustableShelf ?? ""}
                                      onChange={(e) => updateInitialDraftCutlistRow(draft.id, { adjustableShelf: numericOnlyText(e.target.value) })}
                                      className="h-[18px] w-full min-w-0 rounded-[5px] border bg-transparent px-1 text-[9px]"
                                      style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }}
                                    />
                                  </div>
                                  {hasShelfQuantity(draft.adjustableShelf) && (
                                    <div className="-mt-[5px] grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                      <span className="inline-flex w-full items-center justify-end gap-[2px] pr-[3px] text-[9px] font-bold leading-none" style={{ color: draftTextColor }}>
                                        <DrillingArrowIcon color={draftTextColor} />
                                        Drilling
                                      </span>
                                      <div className="w-full min-w-0">
                                        <BoardPillDropdown
                                          value={normalizeDrillingValue(draft.adjustableShelfDrilling)}
                                          options={DRILLING_OPTIONS}
                                          disabled={salesReadOnly}
                                          bg={draftFieldBg}
                                          border={draftFieldBorder}
                                          text={draftTextColor}
                                          size="compact"
                                          className="!h-[18px] !rounded-[5px] !text-[9px]"
                                          getSize={() => ""}
                                          getLabel={(v) => v}
                                          onChange={(v) => updateInitialDraftCutlistRow(draft.id, { adjustableShelfDrilling: normalizeDrillingValue(v) })}
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <>
                                <div style={initialCutlistEntrySubCellStyle("clashing", 0)}>
                                  <BoardPillDropdown
                                    value={draft.clashLeft ?? ""}
                                    options={CLASH_LEFT_OPTIONS}
                                    disabled={salesReadOnly || isDrawerPartType(draft.partType)}
                                    bg={draftFieldBg}
                                    border={draftFieldBorder}
                                    text={draftTextColor}
                                    size="default"
                                    getSize={() => ""}
                                    getLabel={(v) => v}
                                    onChange={(v) => updateInitialDraftCutlistRow(draft.id, { clashLeft: v })}
                                  />
                                </div>
                                <div style={initialCutlistEntrySubCellStyle("clashing", 1)}>
                                  <BoardPillDropdown
                                    value={draft.clashRight ?? ""}
                                    options={CLASH_RIGHT_OPTIONS}
                                    disabled={salesReadOnly || isDrawerPartType(draft.partType)}
                                    bg={draftFieldBg}
                                    border={draftFieldBorder}
                                    text={draftTextColor}
                                    size="default"
                                    getSize={() => ""}
                                    getLabel={(v) => v}
                                    onChange={(v) => updateInitialDraftCutlistRow(draft.id, { clashRight: v })}
                                  />
                                </div>
                              </>
                            )}
                            <div className="grid gap-[2px]" style={initialCutlistEntryCellStyle("information")}>
                              {informationLinesFromValue(draft.information).map((line, idx) => (
                                <div key={`${draft.id}_im_info_${idx}`} className="flex items-center gap-[3px]">
                                  <button
                                    type="button"
                                    disabled={salesReadOnly}
                                    onClick={() => (idx === 0 ? onInitialDraftAddInformationLine(draft.id) : onInitialDraftRemoveInformationLine(draft.id, idx))}
                                    className={
                                      idx === 0
                                        ? "inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#A9DDBF] bg-[#EAF8F0] text-[20px] font-bold leading-none text-[#1F8A4C] hover:bg-[#DDF2E7] disabled:opacity-55"
                                        : "inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[11px] font-bold text-[#C62828] disabled:opacity-55"
                                    }
                                  >
                                    {idx === 0 ? <Plus size={16} className="mx-auto" strokeWidth={2.8} /> : <X size={15} className="mx-auto" strokeWidth={2.8} />}
                                  </button>
                                  <input
                                    disabled={salesReadOnly}
                                    value={line}
                                    onChange={(e) => onInitialDraftInformationLineChange(draft.id, idx, e.target.value)}
                                    placeholder="Information"
                                    className="h-8 flex-1 rounded-[8px] border bg-transparent px-2 text-[12px]"
                                    style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }}
                                  />
                                </div>
                              ))}
                            </div>
                            {showInitialCutlistGrainColumn && (
                              draftBoardAllowsGrain ? (
                                <div style={initialCutlistEntryCellStyle("grain")}>
                                  <BoardPillDropdown
                                    value={String(draft.grainValue ?? "")}
                                    options={initialMeasureGrainDimensionOptionsForRow(draft)}
                                    disabled={salesReadOnly}
                                    bg={draftFieldBg}
                                    border={draftFieldBorder}
                                    text={draftTextColor}
                                    size="default"
                                    getSize={() => ""}
                                    getLabel={(v) => v}
                                    onChange={(v) =>
                                      updateInitialDraftCutlistRow(draft.id, {
                                        grainValue: v,
                                        grain: Boolean(String(v).trim()),
                                      })
                                    }
                                  />
                                </div>
                              ) : (
                                <div style={initialCutlistEntryCellStyle("grain")} />
                              )
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      disabled={salesReadOnly}
                      onClick={() => void addInitialDraftRowsToCutlist()}
                      className="inline-flex h-[50px] w-full items-center justify-center border-y border-[#BFE8CF] bg-[#DDF2E7] text-[24px] font-extrabold text-[#14532D] disabled:opacity-55"
                    >
                      Add to Cutlist
                    </button>
                  </div>
                </section>
              )}

              <section className="relative z-10 -mx-4 w-[calc(100%+2rem)] overflow-visible">
                <div className="flex h-[50px] items-center justify-between px-1">
                  <div className="inline-flex items-center gap-2">
                    <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Cutlist List</p>
                    <p className="rounded-[999px] border border-[#D6DEE9] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#334155]">
                      {formatPartCount(visibleInitialCutlistRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0))}
                    </p>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2 pr-1">
                    <input value={initialCutlistSearch} onChange={(e) => setInitialCutlistSearch(e.target.value)} placeholder="Search part name or board" className="h-8 w-[180px] rounded-[8px] border border-[#D8DEE8] bg-[#EEF1F5] px-2 text-[12px] sm:w-[240px] md:w-[280px]" />
                    <select value={initialCutlistPartTypeFilter} onChange={(e) => setInitialCutlistPartTypeFilter(e.target.value)} className="h-8 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]">
                      <option>All Part Types</option>
                      {initialMeasurePartTypeOptions.map((v) => (
                        <option key={`im_full_filter_${v}`} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-col space-y-2 px-0 pb-0">
                  <div className="overflow-visible bg-transparent">
                    {groupedInitialCutlistRows.length === 0 && (
                      <div className="px-3 py-6 text-center text-[12px] text-[#7A8798]">No cutlist rows yet.</div>
                    )}
                    {groupedInitialCutlistRows.map((group) => {
                      const color = partTypeColors[group.partType] ?? "#CBD5E1";
                      const palette = groupColorPalette(color);
                      const groupTextColor = palette.text;
                      const collapsed = Boolean(initialCollapsedCutlistGroups[group.partType]);
                      const groupPartCount = group.rows.reduce((sum, row) => {
                        const qty = Number(row.quantity);
                        return sum + (Number.isFinite(qty) ? qty : 0);
                      }, 0);
                      const pendingGroupRows = Array.isArray(initialPendingDeleteRowsByGroup[group.partType])
                        ? initialPendingDeleteRowsByGroup[group.partType]
                        : [];
                      const pendingGroupCount = pendingGroupRows.length;
                      const groupDeleteConfirmArmed = Boolean(initialDeleteConfirmArmedGroups[group.partType]);
                      return (
                        <section
                          key={`im_group_${group.partType}`}
                          className="mb-2 w-full border-y last:mb-0"
                          style={{ borderTopColor: color, borderBottomColor: color }}
                        >
                          <div
                            className="flex h-[50px] items-center justify-between border-b pl-0"
                            style={{
                              backgroundColor: palette.titleBarBg,
                              color: groupTextColor,
                              borderBottomColor: color,
                            }}
                          >
                            <div className="flex h-full items-center gap-3">
                              <span
                                className="inline-flex h-full items-center px-3 text-[24px] font-medium leading-none"
                                style={{
                                  backgroundColor: palette.titleChipBg,
                                  color: groupTextColor,
                                }}
                              >
                                {group.partType}
                              </span>
                              <span className="text-[12px] font-bold">{formatPartCount(groupPartCount)}</span>
                              {pendingGroupCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => void deletePendingInitialCutlistRowsForGroup(group.partType)}
                                  className="inline-flex h-8 items-center justify-center rounded-[8px] border px-3 text-[12px] font-bold"
                                  style={{
                                    borderColor: groupDeleteConfirmArmed ? "#8AC0A0" : "#F2A7A7",
                                    backgroundColor: groupDeleteConfirmArmed ? "#DFF3E7" : "#FFECEC",
                                    color: groupDeleteConfirmArmed ? "#1E6A43" : "#991B1B",
                                  }}
                                  title={groupDeleteConfirmArmed ? "Confirm delete selected rows" : "Delete selected rows"}
                                >
                                  {groupDeleteConfirmArmed ? `Confirm (${pendingGroupCount})` : `Delete (${pendingGroupCount})`}
                                </button>
                              )}
                            </div>
                            <div className="flex h-full items-center">
                              <button
                                type="button"
                                onClick={() => toggleInitialCutlistGroup(group.partType)}
                                className="flex h-[50px] min-w-[52px] items-center justify-center border-l text-current"
                                style={{
                                  borderLeftColor: palette.divider,
                                  backgroundColor: palette.titleBarBg,
                                }}
                              >
                                {collapsed ? <Plus size={24} strokeWidth={2.6} /> : <Minus size={24} strokeWidth={2.6} />}
                              </button>
                            </div>
                          </div>
                          {!collapsed && (
                          <table className="w-full table-fixed text-left text-[12px]">
                            <thead style={{ backgroundColor: palette.headerBg, color: groupTextColor }}>
                              <tr>
                                <th className="px-2 py-2" style={{ width: 78, minWidth: 78, maxWidth: 78 }}></th>
                                {showRoomColumnInInitialList && <th className="px-2 py-2" style={{ color: groupTextColor, width: 150, minWidth: 150 }}>Room</th>}
                                {initialCutlistListColumnDefs.map((col) => (
                                  <th
                                    key={`im_full_list_h_${group.partType}_${col.key}`}
                                    className={`px-2 py-2 ${cutlistHeaderAlignClass(col.key as CutlistEditableField)}`}
                                    style={{ ...cutlistListColumnStyle(col.key as CutlistEditableField), color: groupTextColor }}
                                  >
                                    {col.key === "clashing" && isCabinetryPartType(group.partType) ? "Shelves" : col.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((row, idx) => {
                                const rowPartColor = partTypeColors[row.partType || "Unassigned"] ?? "#CBD5E1";
                                const rowPartTextColor = isLightHex(rowPartColor) ? "#000000" : "#FFFFFF";
                                return (
                                  <tr
                                    key={`im_full_row_${group.partType}_${row.id}_${idx}`}
                                    className="border-t"
                                    style={{ backgroundColor: palette.rowBg, color: groupTextColor, borderTopColor: palette.divider }}
                                  >
                                <td className="px-2 py-[3px] align-middle" style={{ width: 78, minWidth: 78, maxWidth: 78 }}>
                                      {(() => {
                                        const rowPendingDelete = pendingGroupRows.includes(row.id);
                                        return (
                                          <button
                                            type="button"
                                            disabled={salesReadOnly}
                                            onClick={() => toggleInitialPendingCutlistRowDelete(group.partType, row.id)}
                                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border disabled:opacity-55"
                                            style={{
                                              borderColor: rowPendingDelete ? "#8AC0A0" : "#F4B5B5",
                                              backgroundColor: rowPendingDelete ? "#DFF3E7" : "#FCEAEA",
                                              color: rowPendingDelete ? "#1E6A43" : "#C62828",
                                            }}
                                          >
                                            {rowPendingDelete ? (
                                              <img src="/tick.png" alt="Selected" className="h-[11px] w-[11px] object-contain" />
                                            ) : (
                                              <X size={11} strokeWidth={2.5} />
                                            )}
                                          </button>
                                        );
                                      })()}
                                    </td>
                                    {showRoomColumnInInitialList && (
                                      <td
                                        className="px-2 py-[3px] align-middle"
                                        style={{ width: 150, minWidth: 150, color: groupTextColor }}
                                        onDoubleClick={() => startInitialCellEdit(row, "room")}
                                      >
                                        {isInitialEditing(row.id, "room") ? (
                                          <select
                                            autoFocus
                                            value={initialEditingCellValue}
                                            onChange={(e) => setInitialEditingCellValue(e.target.value)}
                                            onBlur={() => void commitInitialCellEdit()}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                void commitInitialCellEdit();
                                              }
                                              if (e.key === "Escape") cancelInitialCellEdit();
                                            }}
                                            className="h-6 w-full min-w-0 max-w-full rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                          >
                                            {initialCutlistEntryRoomOptions.map((opt) => (
                                              <option key={`im_room_${opt}`} value={opt}>{opt}</option>
                                            ))}
                                          </select>
                                        ) : (
                                          row.room
                                        )}
                                      </td>
                                    )}
                                    {initialCutlistListColumnDefs.map((col) => {
                                      const key = col.key as CutlistEditableField;
                                      if (key === "partType") {
                                        const options = Array.from(new Set([row.partType, ...initialMeasurePartTypeOptions].filter(Boolean)));
                                        return (
                                          <td
                                            key={`im_full_list_c_${row.id}_${key}`}
                                            className={`px-2 py-[3px] align-middle ${cutlistCellAlignClass(key)}`}
                                            style={{ ...cutlistListColumnStyle(key), color: groupTextColor }}
                                            onDoubleClick={() => startInitialCellEdit(row, key)}
                                          >
                                            {isInitialEditing(row.id, key) ? (
                                              <select
                                                autoFocus
                                                value={initialEditingCellValue}
                                                onChange={(e) => setInitialEditingCellValue(e.target.value)}
                                                onBlur={() => void commitInitialCellEdit()}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    void commitInitialCellEdit();
                                                  }
                                                  if (e.key === "Escape") cancelInitialCellEdit();
                                                }}
                                                className="h-6 w-full min-w-0 max-w-full rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                              >
                                                <option value=""></option>
                                                {options.map((opt) => (
                                                  <option key={`im_pt_${opt}`} value={opt}>{opt}</option>
                                                ))}
                                              </select>
                                            ) : (
                                              <button
                                                type="button"
                                                disabled={salesReadOnly}
                                                onClick={() => startInitialCellEdit(row, key)}
                                                className="inline-flex rounded-[8px] border px-2 py-[2px] text-[11px] font-medium disabled:opacity-60"
                                                style={{
                                                  borderColor: rowPartColor,
                                                  backgroundColor: rowPartColor,
                                                  color: rowPartTextColor,
                                                }}
                                              >
                                                {row.partType || "Unassigned"}
                                              </button>
                                            )}
                                          </td>
                                        );
                                      }
                                      if (key === "board") {
                                        const options = Array.from(new Set([row.board, ...initialMeasureBoardOptions].filter(Boolean)));
                                        return (
                                          <td
                                            key={`im_full_list_c_${row.id}_${key}`}
                                            className={`px-2 py-[3px] align-middle ${cutlistCellAlignClass(key)}`}
                                            style={{ ...cutlistListColumnStyle(key), color: groupTextColor }}
                                            onDoubleClick={() => startInitialCellEdit(row, key)}
                                          >
                                            {isInitialEditing(row.id, key) ? (
                                              <select
                                                autoFocus
                                                value={initialEditingCellValue}
                                                onChange={(e) => setInitialEditingCellValue(e.target.value)}
                                                onBlur={() => void commitInitialCellEdit()}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    void commitInitialCellEdit();
                                                  }
                                                  if (e.key === "Escape") cancelInitialCellEdit();
                                                }}
                                                className="h-6 w-full min-w-0 max-w-full rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                              >
                                                {options.map((opt) => (
                                                  <option key={`im_board_${opt}`} value={opt}>{boardDisplayLabel(opt)}</option>
                                                ))}
                                              </select>
                                            ) : (
                                              <div className="inline-flex items-center gap-2">
                                                {boardSizeFor(row.board) && (
                                                  <span
                                                    className="inline-flex h-5 min-w-[28px] items-center justify-center rounded-[999px] px-2 text-[10px] font-bold"
                                                    style={{ backgroundColor: darkenHex(rowPartColor, 0.15), color: rowPartTextColor }}
                                                  >
                                                    {boardSizeFor(row.board)}
                                                  </span>
                                                )}
                                                <span>{boardDisplayLabel(row.board)}</span>
                                              </div>
                                            )}
                                          </td>
                                        );
                                      }
                                      const value =
                                        key === "name" ? row.name :
                                        key === "height" ? row.height :
                                        key === "width" ? row.width :
                                        key === "depth" ? row.depth :
                                        key === "quantity" ? row.quantity :
                                        key === "clashing" ? joinClashing(String(row.clashLeft ?? ""), String(row.clashRight ?? "")) :
                                        key === "grain" ? String(row.grainValue ?? "") :
                                        row.information;
                                      return (
                                        <td
                                          key={`im_full_list_c_${row.id}_${key}`}
                                          className={`px-2 py-[3px] align-middle ${cutlistCellAlignClass(key)}`}
                                          style={{ ...cutlistListColumnStyle(key), color: groupTextColor }}
                                          onDoubleClick={() => startInitialCellEdit(row, key)}
                                        >
                                          {isInitialEditing(row.id, key) ? (
                                            key === "grain" ? (
                                              <select
                                                autoFocus
                                                value={initialEditingCellValue}
                                                onChange={(e) => setInitialEditingCellValue(e.target.value)}
                                                onBlur={() => void commitInitialCellEdit()}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    void commitInitialCellEdit();
                                                  }
                                                  if (e.key === "Escape") cancelInitialCellEdit();
                                                }}
                                                className="h-6 w-full min-w-0 max-w-full rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                              >
                                                <option value="">-</option>
                                                {initialMeasureGrainDimensionOptionsForRow(row).map((opt) => (
                                                  <option key={`im_grain_${row.id}_${opt}`} value={opt}>{opt}</option>
                                                ))}
                                              </select>
                                            ) : (
                                              <input
                                                autoFocus
                                                value={initialEditingCellValue}
                                                onChange={(e) => setInitialEditingCellValue(isNumericCutlistInputKey(key) ? numericOnlyText(e.target.value) : e.target.value)}
                                                onBlur={() => void commitInitialCellEdit()}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    void commitInitialCellEdit();
                                                  }
                                                  if (e.key === "Escape") cancelInitialCellEdit();
                                                }}
                                                className={`h-6 w-full min-w-0 max-w-full rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A] ${cutlistCellAlignClass(key) === "text-center" ? "text-center" : "text-left"}`}
                                              />
                                            )
                                          ) : (
                                            String(value ?? "")
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          )}
                        </section>
                      );
                    })}
                  </div>
                </div>
              </section>
            </div>
          </div>
          {addRoomModalPortal}
        </div>
      </ProtectedRoute>
    );
  }

  if (isCutlistFullscreen) {
    return (
      <ProtectedRoute>
        <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--bg-app)]">
          <div className="sticky top-0 z-[95] flex h-[56px] shrink-0 items-center justify-between border-b border-[#D7DEE8] bg-white px-4 md:px-5">
            <div className="inline-flex items-center gap-2 text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">
              <Scissors size={14} />
              <span>Cutlist</span>
              <span className="text-[#6B7280]">|</span>
              <span className="truncate text-[#334155]">{project?.name || "Project"}</span>
            </div>
            <button
              type="button"
              onClick={() => void onSaveAndBackFromCutlist()}
              className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#C8DAFF] bg-[#EAF1FF] px-3 text-[12px] font-bold text-[#24589A] hover:bg-[#DFE9FF]"
            >
              <ArrowLeft size={14} />
              Save & Back
            </button>
          </div>
          <div className="shrink-0 overflow-hidden border-b border-[#DCE3EC] bg-white px-3 py-1">
            <div
              ref={cutlistActivityScrollRef}
              className="w-full max-w-full min-w-0 overflow-hidden whitespace-nowrap"
              dir="ltr"
              style={{ userSelect: "none", touchAction: "none" }}
              onDragStart={(e) => e.preventDefault()}
            >
              <div
                ref={cutlistActivityInnerRef}
                className="inline-flex w-max cursor-grab items-center gap-[10px] pr-2"
                dir="ltr"
                style={{
                  userSelect: "none",
                  touchAction: "none",
                  transform: `translate3d(${cutlistActivityOffset}px, 0, 0)`,
                  willChange: "transform",
                  transition: cutlistActivityIsDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
                onPointerDown={onCutlistActivityPointerDown}
                onPointerUp={endCutlistActivityPointerDrag}
                onPointerCancel={endCutlistActivityPointerDrag}
              >
                {productionCutlistActivityFeed.map((entry, idx) => {
                  const colors = activityColorsForPart(entry.partType || "", entry.actionKind || "");
                  const isPartTypeMove = Boolean(entry.partType && entry.partTypeTo);
                  const isValueMove = Boolean(entry.valueFrom || entry.valueTo);
                  const isEntering = Boolean(cutlistActivityEnteringIds[entry.id]);
                  const rawMessage = String(entry.message || "");
                  const messageLower = rawMessage.toLowerCase();
                  let messagePrefix = rawMessage;
                  let actionText = "";
                  let messageSuffix = "";
                  if (!isPartTypeMove && !isValueMove) {
                    const addedToken = " added to ";
                    const addedIdx = messageLower.indexOf(addedToken);
                    if (addedIdx > 0) {
                      messagePrefix = rawMessage.slice(0, addedIdx).trim();
                      actionText = "added to";
                      messageSuffix = rawMessage.slice(addedIdx + addedToken.length).trim();
                    } else if (messageLower.endsWith(" removed")) {
                      messagePrefix = rawMessage.slice(0, rawMessage.length - " removed".length).trim();
                      actionText = "removed";
                      messageSuffix = "";
                    }
                  }
                  return (
                    <div
                      key={entry.id}
                      className="inline-flex items-center gap-[10px] rounded-[9px] border px-2 py-[2px]"
                      style={{
                        backgroundColor: colors.chipBg,
                        borderColor: colors.chipBorder,
                        marginRight: idx < productionCutlistActivityFeed.length - 1 ? 10 : 0,
                        opacity: isEntering ? 0 : 1,
                        transform: isEntering ? "translate3d(12px,0,0)" : "translate3d(0,0,0)",
                        transition: "opacity 240ms ease, transform 240ms ease",
                      }}
                    >
                      {!!messagePrefix && !!actionText && (
                        <span
                          className="inline-flex h-[18px] items-center rounded-[8px] border px-2 text-[11px] font-bold"
                          style={{
                            backgroundColor: colors.pillBg,
                            borderColor: colors.pillBorder,
                            color: colors.pillText,
                          }}
                        >
                          {messagePrefix}
                        </span>
                      )}
                      {!!messagePrefix && !actionText && (
                        <span className="text-[11px] font-bold" style={{ color: colors.chipText, paddingRight: 5 }}>
                          {messagePrefix}
                        </span>
                      )}
                      {!!actionText && (
                        <span className="text-[11px] font-bold" style={{ color: colors.chipText }}>
                          {actionText}
                        </span>
                      )}
                      {!!messageSuffix && (
                        <span className="text-[11px] font-bold" style={{ color: colors.chipText, paddingLeft: 5 }}>
                          {messageSuffix}
                        </span>
                      )}
                      {isPartTypeMove && !!entry.partType && (
                        <>
                          <span
                            className="inline-flex h-[18px] items-center rounded-[8px] border px-2 text-[11px] font-bold"
                            style={{
                              backgroundColor: colors.pillBg,
                              borderColor: colors.pillBorder,
                              color: colors.pillText,
                            }}
                          >
                            {entry.partType}
                          </span>
                          <span className="inline-flex items-center" style={{ paddingLeft: 5, paddingRight: 5 }}>
                            <img
                              src="/arrow-right.png"
                              alt="to"
                              className="shrink-0 object-contain opacity-90"
                              style={{ width: 20, height: 20 }}
                            />
                          </span>
                        </>
                      )}
                      {isValueMove && !isPartTypeMove && (
                        <>
                          <span
                            className="inline-flex h-[18px] items-center rounded-[8px] border px-2 text-[11px] font-bold"
                            style={{
                              backgroundColor: colors.pillBg,
                              borderColor: colors.pillBorder,
                              color: colors.pillText,
                            }}
                          >
                            {entry.valueFrom || "-"}
                          </span>
                          <span className="inline-flex items-center" style={{ paddingLeft: 5, paddingRight: 5 }}>
                            <img
                              src="/arrow-right.png"
                              alt="to"
                              className="shrink-0 object-contain opacity-90"
                              style={{ width: 20, height: 20 }}
                            />
                          </span>
                        </>
                      )}
                      {!!entry.partTypeTo && (
                        <span
                          className="inline-flex h-[18px] items-center rounded-[8px] border px-2 text-[11px] font-bold"
                          style={{
                            backgroundColor: activityColorsForPart(entry.partTypeTo || "").pillBg,
                            borderColor: activityColorsForPart(entry.partTypeTo || "").pillBorder,
                            color: activityColorsForPart(entry.partTypeTo || "").pillText,
                          }}
                        >
                          {entry.partTypeTo}
                        </span>
                      )}
                      {isValueMove && !isPartTypeMove && (
                        <span
                          className="inline-flex h-[18px] items-center rounded-[8px] border px-2 text-[11px] font-bold"
                          style={{
                            backgroundColor: colors.pillBg,
                            borderColor: colors.pillBorder,
                            color: colors.pillText,
                          }}
                        >
                          {entry.valueTo || "-"}
                        </span>
                      )}
                      {String(entry.actionKind || "") === "clear" && (
                        <button
                          type="button"
                          onClick={() => removeCutlistActivity(entry.id)}
                          data-cutlist-activity-control="true"
                          className="inline-flex h-[18px] items-center rounded-[8px] border border-[#F2A7A7] bg-[#FFECEC] px-2 text-[10px] font-extrabold text-[#991B1B] hover:bg-[#FFDCDC]"
                        >
                          {entry.action || "Clear"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[190px_1fr]">
            <aside className="border-r border-[#DCE3EC] bg-white">
              <div className="p-2">
                <p className="mb-2 px-2 text-[16px] font-medium text-[#111827]">Rooms</p>
                <div className="space-y-1">
                  {cutlistAddedRoomTabs.map((roomTab) => {
                    const active = cutlistRoomFilter === roomTab.filter;
                    return (
                      <button
                        key={`${roomTab.label}_${roomTab.filter}`}
                        type="button"
                        onClick={() => setCutlistRoomFilter(roomTab.filter)}
                        className={`w-full rounded-[9px] px-2 py-2 text-left text-[12px] font-semibold ${
                          active ? "bg-[#E9EFF7] text-[#12345B]" : "text-[#334155] hover:bg-[#F1F5F9]"
                        }`}
                      >
                        {roomTab.label}
                      </button>
                    );
                  })}
                  <div className="my-2 h-px bg-[#DCE3EC]" />
                  {cutlistRoomTabs
                    .filter((tab) => tab.filter === "Project Cutlist")
                    .map((roomTab) => {
                      const active = cutlistRoomFilter === roomTab.filter;
                      return (
                        <button
                          key={`${roomTab.label}_${roomTab.filter}`}
                          type="button"
                          onClick={() => setCutlistRoomFilter(roomTab.filter)}
                          className={`w-full rounded-[9px] px-2 py-2 text-left text-[12px] font-semibold ${
                            active ? "bg-[#E9EFF7] text-[#12345B]" : "text-[#334155] hover:bg-[#F1F5F9]"
                          }`}
                        >
                          {roomTab.label}
                        </button>
                      );
                    })}
                  <button
                    type="button"
                    disabled={!salesAccess.edit || isSavingSalesRooms}
                    onClick={() => void onAddCutlistRoom()}
                    className="mt-2 w-full rounded-[9px] border border-[#BFE8CF] bg-[#DDF2E7] px-2 py-2 text-left text-[12px] font-bold text-[#1F6A3B] disabled:opacity-55"
                  >
                    + Add Room
                  </button>
                </div>
              </div>
            </aside>

            <div className="flex min-h-full flex-col gap-4 overflow-auto p-4">
              {cutlistRoomFilter !== "Project Cutlist" && (
              <section className="relative z-10 -mx-4 w-[calc(100%+2rem)] overflow-visible">
                <div className="flex h-[50px] items-center px-1">
                  <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Cutlist Entry</p>
                </div>
                <div className="space-y-3 px-0 pb-0">
                  <div className="flex flex-wrap items-center gap-2 px-1">
                    {partTypeOptions.map((v) => {
                      const color = partTypeColors[v] ?? "#CBD5E1";
                      return (
                        <button
                          key={v}
                          type="button"
                          disabled={productionReadOnly}
                          onClick={() => addDraftRowForPartType(v)}
                          style={{
                            backgroundColor: color,
                            borderColor: color,
                            color: isLightHex(color) ? "#1F2937" : "#F8FAFC",
                          }}
                          className="rounded-[8px] border px-2 py-1 text-[11px] font-medium disabled:opacity-55"
                        >
                          {v}
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid gap-2 text-[11px] font-bold text-[#8A97A8]" style={{ gridTemplateColumns: cutlistEntryGridTemplate }}>
                    <p></p>
                    {cutlistEntryColumnDefs.map((col) => (
                      <p
                        key={`draft_header_${col.key}`}
                        className={isCenteredCutlistColumn(col.key) ? "text-center" : ""}
                        style={col.key === "clashing" ? cutlistEntryCellStyle("clashing", 2) : cutlistEntryCellStyle(col.key)}
                      >
                        {col.key === "clashing" ? (draftEntryShowsShelvesHeader ? "Shelves" : "Clashing") : col.label}
                      </p>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {cutlistDraftRows.map((draft) => {
                      const color = partTypeColors[draft.partType] ?? "#CBD5E1";
                      const draftTextColor = isLightHex(color) ? "#1F2937" : "#F8FAFC";
                      const draftFieldBg = lightenHex(color, 0.12);
                      const draftFieldBorder = darkenHex(color, 0.2);
                      const draftIsCabinetry = isCabinetryPartType(draft.partType);
                      const draftBoardAllowsGrain = initialMeasureBoardGrainFor(String(draft.board ?? "").trim());
                      const draftGrainValue = String(draft.grainValue ?? "").trim();
                      const draftHeightGrainMatch = matchesGrainDimension(draftGrainValue, draft.height, "height");
                      const draftWidthGrainMatch = matchesGrainDimension(draftGrainValue, draft.width, "width");
                      const draftDepthGrainMatch = matchesGrainDimension(draftGrainValue, draft.depth, "depth");
                      const boardWarn = warningForCell(draft.id, "board");
                      const nameWarn = warningForCell(draft.id, "name");
                      const heightWarn = warningForCell(draft.id, "height");
                      const widthWarn = warningForCell(draft.id, "width");
                      const depthWarn = warningForCell(draft.id, "depth");
                      const quantityWarn = warningForCell(draft.id, "quantity");
                      return (
                        <div
                          key={draft.id}
                          className="relative grid items-center gap-2 overflow-visible border-y px-1 py-1"
                          style={{ gridTemplateColumns: cutlistEntryGridTemplate, backgroundColor: color, color: draftTextColor, borderColor: draftFieldBorder }}
                        >
                          <button
                            type="button"
                            disabled={productionReadOnly}
                            onClick={() => removeDraftCutlistRow(draft.id)}
                            className="h-8 w-8 rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[11px] font-bold text-[#C62828] disabled:opacity-55"
                          >
                            <X size={15} className="mx-auto" strokeWidth={2.8} />
                          </button>
                          <div className="relative z-[120] pointer-events-auto" style={cutlistEntryCellStyle("board")}>
                            <BoardPillDropdown
                              value={draft.board}
                              options={cutlistBoardOptions}
                              disabled={productionReadOnly}
                              title={boardWarn || undefined}
                              className={warningClassForCell(draft.id, "board")}
                              bg={warningStyleForCell(draft.id, "board", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }).backgroundColor ?? draftFieldBg}
                              border={warningStyleForCell(draft.id, "board", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }).borderColor ?? draftFieldBorder}
                              text={warningStyleForCell(draft.id, "board", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }).color ?? draftTextColor}
                              getSize={boardSizeFor}
                              getLabel={boardDisplayLabel}
                              onChange={(next) => onDraftBoardChange(draft.id, next)}
                            />
                          </div>
                          <PartNameSuggestionInput
                            disabled={productionReadOnly}
                            title={nameWarn || undefined}
                            value={draft.name}
                            options={productionPartNameSuggestionsForRoom(draft.room, draft.name)}
                            onChange={(next) => updateDraftCutlistRow(draft.id, { name: next })}
                            containerStyle={cutlistEntryCellStyle("name")}
                            className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] ${warningClassForCell(draft.id, "name")}`}
                            style={warningStyleForCell(draft.id, "name", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor })}
                          />
                          {isDrawerPartType(draft.partType) ? (
                            <div style={cutlistEntryCellStyle("height")}>
                            <DrawerHeightDropdown
                              value={String(draft.height || "")}
                              options={drawerHeightLetterOptions}
                              disabled={productionReadOnly}
                              title={heightWarn || undefined}
                              className={warningClassForCell(draft.id, "height")}
                              bg={warningStyleForCell(draft.id, "height", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }).backgroundColor ?? draftFieldBg}
                              border={warningStyleForCell(draft.id, "height", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }).borderColor ?? draftFieldBorder}
                              text={warningStyleForCell(draft.id, "height", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }).color ?? draftTextColor}
                              onAdd={(token) => addDraftDrawerHeightToken(draft.id, token)}
                              onRemove={(token) => removeDraftDrawerHeightToken(draft.id, token)}
                            />
                            </div>
                          ) : (
                            <input disabled={productionReadOnly} inputMode="numeric" pattern="[0-9]*" title={heightWarn || undefined} value={draft.height} onChange={(e) => updateDraftCutlistRow(draft.id, { height: numericOnlyText(e.target.value) })} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center ${warningClassForCell(draft.id, "height")}`} style={{ ...warningStyleForCell(draft.id, "height", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }), ...(draftHeightGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : {}), ...cutlistEntryCellStyle("height") }} />
                          )}
                          <input disabled={productionReadOnly} inputMode="numeric" pattern="[0-9]*" title={widthWarn || undefined} value={draft.width} onChange={(e) => updateDraftCutlistRow(draft.id, { width: numericOnlyText(e.target.value) })} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center ${warningClassForCell(draft.id, "width")}`} style={{ ...warningStyleForCell(draft.id, "width", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }), ...(draftWidthGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : {}), ...cutlistEntryCellStyle("width") }} />
                          <input disabled={productionReadOnly} inputMode="numeric" pattern="[0-9]*" title={depthWarn || undefined} value={draft.depth} onChange={(e) => updateDraftCutlistRow(draft.id, { depth: numericOnlyText(e.target.value) })} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center ${warningClassForCell(draft.id, "depth")}`} style={{ ...warningStyleForCell(draft.id, "depth", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }), ...(draftDepthGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : {}), ...cutlistEntryCellStyle("depth") }} />
                          <input disabled={productionReadOnly || isDrawerPartType(draft.partType)} inputMode="numeric" pattern="[0-9]*" title={quantityWarn || undefined} value={draft.quantity} onChange={(e) => updateDraftCutlistRow(draft.id, { quantity: numericOnlyText(e.target.value) })} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center disabled:opacity-90 ${warningClassForCell(draft.id, "quantity")}`} style={{ ...warningStyleForCell(draft.id, "quantity", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }), ...cutlistEntryCellStyle("quantity") }} />
                          {draftIsCabinetry ? (
                            <div className="grid content-start gap-[1px]" style={cutlistEntryCellStyle("clashing", 2)}>
                              <div className="grid content-start gap-0">
                                <div className="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                  <span className="block pr-[3px] text-right text-[9px] font-bold leading-none" style={{ color: draftTextColor }}>Fixed Shelf</span>
                                  <input
                                    disabled={productionReadOnly}
                                    value={draft.fixedShelf ?? ""}
                                    onChange={(e) => updateDraftCutlistRow(draft.id, { fixedShelf: numericOnlyText(e.target.value) })}
                                    className="h-[18px] w-full min-w-0 rounded-[5px] border bg-transparent px-1 text-[9px]"
                                    style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }}
                                  />
                                </div>
                                {hasShelfQuantity(draft.fixedShelf) && (
                                  <div className="-mt-[5px] grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                    <span className="inline-flex w-full items-center justify-end gap-[2px] pr-[3px] text-[9px] font-bold leading-none" style={{ color: draftTextColor }}>
                                      <DrillingArrowIcon color={draftTextColor} />
                                      Drilling
                                    </span>
                                    <div className="w-full min-w-0">
                                      <BoardPillDropdown
                                        value={normalizeDrillingValue(draft.fixedShelfDrilling)}
                                        options={DRILLING_OPTIONS}
                                        disabled={productionReadOnly}
                                        bg={draftFieldBg}
                                        border={draftFieldBorder}
                                        text={draftTextColor}
                                        size="compact"
                                        className="!h-[18px] !rounded-[5px] !text-[9px]"
                                        getSize={() => ""}
                                        getLabel={(v) => v}
                                        onChange={(v) => updateDraftCutlistRow(draft.id, { fixedShelfDrilling: normalizeDrillingValue(v) })}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="grid content-start gap-0">
                                <div className="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                  <span className="block pr-[3px] text-right text-[9px] font-bold leading-none" style={{ color: draftTextColor }}>Adjustable Shelf</span>
                                  <input
                                    disabled={productionReadOnly}
                                    value={draft.adjustableShelf ?? ""}
                                    onChange={(e) => updateDraftCutlistRow(draft.id, { adjustableShelf: numericOnlyText(e.target.value) })}
                                    className="h-[18px] w-full min-w-0 rounded-[5px] border bg-transparent px-1 text-[9px]"
                                    style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }}
                                  />
                                </div>
                                {hasShelfQuantity(draft.adjustableShelf) && (
                                  <div className="-mt-[5px] grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                    <span className="inline-flex w-full items-center justify-end gap-[2px] pr-[3px] text-[9px] font-bold leading-none" style={{ color: draftTextColor }}>
                                      <DrillingArrowIcon color={draftTextColor} />
                                      Drilling
                                    </span>
                                    <div className="w-full min-w-0">
                                      <BoardPillDropdown
                                        value={normalizeDrillingValue(draft.adjustableShelfDrilling)}
                                        options={DRILLING_OPTIONS}
                                        disabled={productionReadOnly}
                                        bg={draftFieldBg}
                                        border={draftFieldBorder}
                                        text={draftTextColor}
                                        size="compact"
                                        className="!h-[18px] !rounded-[5px] !text-[9px]"
                                        getSize={() => ""}
                                        getLabel={(v) => v}
                                        onChange={(v) => updateDraftCutlistRow(draft.id, { adjustableShelfDrilling: normalizeDrillingValue(v) })}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={cutlistEntrySubCellStyle("clashing", 0)}>
                                <BoardPillDropdown
                                  value={draft.clashLeft ?? ""}
                                  options={CLASH_LEFT_OPTIONS}
                                  disabled={productionReadOnly || isDrawerPartType(draft.partType)}
                                  bg={draftFieldBg}
                                  border={draftFieldBorder}
                                  text={draftTextColor}
                                  size="default"
                                  getSize={() => ""}
                                  getLabel={(v) => v}
                                  onChange={(v) => updateDraftCutlistRow(draft.id, { clashLeft: v })}
                                />
                              </div>
                              <div style={cutlistEntrySubCellStyle("clashing", 1)}>
                                <BoardPillDropdown
                                  value={draft.clashRight ?? ""}
                                  options={CLASH_RIGHT_OPTIONS}
                                  disabled={productionReadOnly || isDrawerPartType(draft.partType)}
                                  bg={draftFieldBg}
                                  border={draftFieldBorder}
                                  text={draftTextColor}
                                  size="default"
                                  getSize={() => ""}
                                  getLabel={(v) => v}
                                  onChange={(v) => updateDraftCutlistRow(draft.id, { clashRight: v })}
                                />
                              </div>
                            </>
                          )}
                          <div className="grid gap-[2px]" style={cutlistEntryCellStyle("information")}>
                            {informationLinesFromValue(draft.information).map((line, idx) => (
                              <div key={`${draft.id}_info_${idx}`} className="flex items-center gap-[3px]">
                                <button
                                  type="button"
                                  disabled={productionReadOnly}
                                  onClick={() => (idx === 0 ? onDraftAddInformationLine(draft.id) : onDraftRemoveInformationLine(draft.id, idx))}
                                  className={
                                    idx === 0
                                      ? "inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#A9DDBF] bg-[#EAF8F0] text-[20px] font-bold leading-none text-[#1F8A4C] hover:bg-[#DDF2E7] disabled:opacity-55"
                                      : "inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[11px] font-bold text-[#C62828] disabled:opacity-55"
                                  }
                                >
                                  {idx === 0 ? <Plus size={16} className="mx-auto" strokeWidth={2.8} /> : <X size={15} className="mx-auto" strokeWidth={2.8} />}
                                </button>
                                <input
                                  disabled={productionReadOnly}
                                  value={line}
                                  onChange={(e) => onDraftInformationLineChange(draft.id, idx, e.target.value)}
                                  placeholder="Information"
                                  className="h-8 flex-1 rounded-[8px] border bg-transparent px-2 text-[12px]"
                                  style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }}
                                />
                              </div>
                            ))}
                          </div>
                          {showCutlistGrainColumn && (
                            draftBoardAllowsGrain ? (
                              <div style={cutlistEntryCellStyle("grain")}>
                                <BoardPillDropdown
                                  value={String(draft.grainValue ?? "")}
                                  options={grainDimensionOptionsForRow(draft)}
                                  disabled={productionReadOnly}
                                  bg={draftFieldBg}
                                  border={draftFieldBorder}
                                  text={draftTextColor}
                                  size="default"
                                  getSize={() => ""}
                                  getLabel={(v) => v}
                                  onChange={(v) =>
                                    updateDraftCutlistRow(draft.id, {
                                      grainValue: v,
                                      grain: Boolean(String(v).trim()),
                                    })
                                  }
                                />
                              </div>
                            ) : (
                              <div style={cutlistEntryCellStyle("grain")} />
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    disabled={productionReadOnly}
                    onClick={() => void addDraftRowsToCutlist()}
                    className="inline-flex h-[50px] w-full items-center justify-center border-y border-[#BFE8CF] bg-[#DDF2E7] text-[24px] font-extrabold text-[#14532D] disabled:opacity-55"
                  >
                    Add to Cutlist
                  </button>
                </div>
              </section>
              )}

              <section className="relative z-10 -mx-4 w-[calc(100%+2rem)] overflow-visible">
                <div className="flex h-[50px] items-center justify-between px-1">
                  <div className="inline-flex items-center gap-2">
                    <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Cutlist List</p>
                    <p className="rounded-[999px] border border-[#D6DEE9] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#334155]">
                      {formatPartCount(visibleCutlistRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0))}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-2 pr-1">
                    <input
                      value={cutlistSearch}
                      onChange={(e) => setCutlistSearch(e.target.value)}
                      placeholder="Search part name or board"
                      className="h-8 w-[280px] rounded-[8px] border border-[#D8DEE8] bg-[#EEF1F5] px-2 text-[12px]"
                    />
                    <select
                      value={cutlistPartTypeFilter}
                      onChange={(e) => setCutlistPartTypeFilter(e.target.value)}
                      className="h-8 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                    >
                      <option value="All Part Types">All Part Types</option>
                      {partTypeOptions.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-col space-y-2 px-0 pb-0">
                  <div className="overflow-visible bg-transparent">
                    {groupedCutlistRows.length === 0 && (
                      <div className="px-3 py-6 text-center text-[12px] text-[#7A8798]">No cutlist rows yet.</div>
                    )}
                    {groupedCutlistRows.map((group) => {
                      const color = partTypeColors[group.partType] ?? "#CBD5E1";
                      const palette = groupColorPalette(color);
                      const groupTextColor = palette.text;
                      const collapsed = Boolean(collapsedCutlistGroups[group.partType]);
                      const groupPartCount = group.rows.reduce((sum, row) => {
                        const qty = Number(row.quantity);
                        return sum + (Number.isFinite(qty) ? qty : 0);
                      }, 0);
                      const pendingGroupRows = Array.isArray(pendingDeleteRowsByGroup[group.partType])
                        ? pendingDeleteRowsByGroup[group.partType]
                        : [];
                      const pendingGroupCount = pendingGroupRows.length;
                      const groupDeleteConfirmArmed = Boolean(deleteConfirmArmedGroups[group.partType]);
                      return (
                        <section
                          key={group.partType}
                          className="mb-2 w-full border-y last:mb-0"
                          style={{ borderTopColor: color, borderBottomColor: color }}
                        >
                          <div
                            className="flex h-[50px] items-center justify-between border-b pl-0"
                            style={{
                              backgroundColor: palette.titleBarBg,
                              color: groupTextColor,
                              borderBottomColor: color,
                            }}
                          >
                            <div className="flex h-full items-center gap-3">
                              <span
                                className="inline-flex h-full items-center px-3 text-[24px] font-medium leading-none"
                                style={{
                                  backgroundColor: palette.titleChipBg,
                                  color: groupTextColor,
                                }}
                              >
                                {group.partType}
                              </span>
                              <span className="text-[12px] font-bold">{formatPartCount(groupPartCount)}</span>
                              {pendingGroupCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => void deletePendingCutlistRowsForGroup(group.partType)}
                                  className="inline-flex h-8 items-center justify-center rounded-[8px] border px-3 text-[12px] font-bold"
                                  style={{
                                    borderColor: groupDeleteConfirmArmed ? "#8AC0A0" : "#F2A7A7",
                                    backgroundColor: groupDeleteConfirmArmed ? "#DFF3E7" : "#FFECEC",
                                    color: groupDeleteConfirmArmed ? "#1E6A43" : "#991B1B",
                                  }}
                                  title={groupDeleteConfirmArmed ? "Confirm delete selected rows" : "Delete selected rows"}
                                >
                                  {groupDeleteConfirmArmed ? `Confirm (${pendingGroupCount})` : `Delete (${pendingGroupCount})`}
                                </button>
                              )}
                            </div>
                            <div className="flex h-full items-center">
                              <button
                                type="button"
                                onClick={() => toggleCutlistGroup(group.partType)}
                                className="flex h-[50px] min-w-[52px] items-center justify-center border-l text-current"
                                style={{
                                  borderLeftColor: palette.divider,
                                  backgroundColor: palette.titleBarBg,
                                }}
                              >
                                {collapsed ? <Plus size={24} strokeWidth={2.6} /> : <Minus size={24} strokeWidth={2.6} />}
                              </button>
                            </div>
                          </div>
                          {!collapsed && (
                          <table className="w-full text-left text-[12px]">
                            <thead style={{ backgroundColor: palette.headerBg, color: groupTextColor }}>
                              <tr>
                                <th className="px-2 py-2" style={{ width: 78, minWidth: 78, maxWidth: 78 }}></th>
                                {showRoomColumnInList && (
                                  <th className="px-2 py-2" style={{ color: groupTextColor, width: 150, minWidth: 150 }}>Room</th>
                                )}
                                {cutlistListColumnDefs.map((col) => (
                                  (() => {
                                    const groupIsCabinetry = isCabinetryPartType(group.partType);
                                    const headerLabel = col.key === "clashing" && groupIsCabinetry ? "Shelves" : col.label;
                                    return (
                                  <th
                                    key={col.label}
                                    className={`px-2 py-2 ${cutlistHeaderAlignClass(col.key as CutlistEditableField)}`}
                                    style={{ color: groupTextColor, ...cutlistListColumnStyle(col.key as CutlistEditableField) }}
                                  >
                                    {headerLabel}
                                  </th>
                                    );
                                  })()
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((row) => {
                                const infoLines = informationLinesFromValue(String(row.information ?? ""));
                                const rowIsCabinetry = isCabinetryPartType(row.partType);
                                const rowIsDrawer = isDrawerPartType(row.partType);
                                const rowPendingDelete = pendingGroupRows.includes(row.id);
                                const cabinetryOpen = Boolean(expandedCabinetryRows[row.id]);
                                const drawerOpen = Boolean(expandedDrawerRows[row.id]);
                                const cabinetryPieces = rowIsCabinetry ? buildCabinetryDerivedPieces(row) : [];
                                const drawerPieces = rowIsDrawer ? buildDrawerDerivedPieces(row) : [];
                                const spillInfoToSubRows = rowIsCabinetry || rowIsDrawer;
                                const visibleSubRowCount = rowIsCabinetry
                                  ? (cabinetryOpen ? cabinetryPieces.length : 0)
                                  : rowIsDrawer
                                    ? (drawerOpen ? drawerPieces.length : 0)
                                    : 0;
                                const mainInfoCount = spillInfoToSubRows
                                  ? Math.max(1, infoLines.length - visibleSubRowCount)
                                  : infoLines.length;
                                const mainInfoLines = spillInfoToSubRows
                                  ? infoLines.slice(0, mainInfoCount)
                                  : infoLines;
                                const overflowInfoLines = spillInfoToSubRows
                                  ? infoLines.slice(mainInfoCount, mainInfoCount + visibleSubRowCount)
                                  : [];
                                return (
                                <Fragment key={row.id}>
                                <tr
                                  data-cutlist-row-id={row.id}
                                  className="border-t"
                                  style={{ backgroundColor: palette.rowBg, color: groupTextColor, borderTopColor: palette.divider }}
                                >
                                  <td className="px-2 py-[3px] align-middle" style={{ width: 78, minWidth: 78, maxWidth: 78 }}>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        disabled={productionReadOnly}
                                        onClick={() => togglePendingCutlistRowDelete(group.partType, row.id)}
                                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border disabled:opacity-55"
                                        style={{
                                          borderColor: rowPendingDelete ? "#8AC0A0" : "#F4B5B5",
                                          backgroundColor: rowPendingDelete ? "#DFF3E7" : "#FCEAEA",
                                          color: rowPendingDelete ? "#1E6A43" : "#C62828",
                                        }}
                                      >
                                        {rowPendingDelete ? (
                                          <img src="/tick.png" alt="Selected" className="h-[11px] w-[11px] object-contain" />
                                        ) : (
                                          <X size={11} strokeWidth={2.5} />
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!(rowIsCabinetry || rowIsDrawer)}
                                        onClick={() => {
                                          if (rowIsCabinetry) {
                                            toggleCabinetryRowExpand(row.id);
                                            return;
                                          }
                                          if (rowIsDrawer) {
                                            toggleDrawerRowExpand(row.id);
                                          }
                                        }}
                                        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border ${(rowIsCabinetry || rowIsDrawer) ? "" : "invisible pointer-events-none"}`}
                                        style={{
                                          backgroundColor: color,
                                          borderColor: darkenHex(color, 0.18),
                                        }}
                                        title={(rowIsCabinetry ? cabinetryOpen : drawerOpen) ? "Collapse pieces" : "Expand pieces"}
                                      >
                                        <img
                                          src="/Arrow.png"
                                          alt="Expand"
                                          className={`h-[11px] w-[11px] transition-transform ${(rowIsCabinetry ? cabinetryOpen : drawerOpen) ? "[transform:rotate(90deg)_scaleX(-1)]" : "[transform:rotate(270deg)_scaleX(-1)]"}`}
                                          style={{ filter: groupTextColor === "#FFFFFF" ? "invert(1) brightness(2)" : "none" }}
                                        />
                                      </button>
                                    </div>
                                  </td>
                                  {showRoomColumnInList && (
                                    <td
                                      className="px-2 py-[3px] align-middle"
                                      onDoubleClick={() => startCellEdit(row, "room")}
                                      style={{ width: 150, minWidth: 150, color: groupTextColor }}
                                    >
                                      {isEditing(row.id, "room") ? (
                                        <select
                                          autoFocus
                                          title={warningForCell(row.id, "room") || undefined}
                                          value={editingCellValue}
                                          onChange={(e) => setEditingCellValue(e.target.value)}
                                          onBlur={() => void commitCellEdit()}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                              e.preventDefault();
                                              void commitCellEdit();
                                            }
                                            if (e.key === "Escape") cancelCellEdit();
                                          }}
                                          className={`h-6 w-full min-w-0 max-w-full rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A] ${warningClassForCell(row.id, "room")}`}
                                          style={warningStyleForCell(row.id, "room", { backgroundColor: "#FFFFFF", borderColor: "#94A3B8", color: "#0F172A" })}
                                        >
                                          {cutlistEntryRoomOptions.map((opt) => (
                                            <option key={opt} value={opt}>{opt}</option>
                                          ))}
                                        </select>
                                      ) : (
                                        row.room
                                      )}
                                    </td>
                                  )}
                                  {cutlistListColumnDefs.map((col) => {
                                    const key = col.key as CutlistEditableField;
                                    const editing = isEditing(row.id, key);
                                    const alignClass = cutlistCellAlignClass(key);
                                    const cellWarn = warningForCell(row.id, key);
                                    const cellWarnClass = warningClassForCell(row.id, key);
                                    if (col.key === "partType") {
                                      const options = Array.from(new Set([row.partType, ...partTypeOptions].filter(Boolean)));
                                      const rowPartColor = partTypeColors[row.partType || "Unassigned"] ?? "#CBD5E1";
                                      const rowPartTextColor = isLightHex(rowPartColor) ? "#000000" : "#FFFFFF";
                                      return (
                                        <td
                                          key={`${row.id}_${col.label}`}
                                          className={`px-2 py-[3px] align-middle ${alignClass}`}
                                          onDoubleClick={() => startCellEdit(row, "partType")}
                                          style={{ ...cutlistListColumnStyle("partType"), color: groupTextColor }}
                                        >
                                          {editing ? (
                                            <select
                                              autoFocus
                                              value={editingCellValue}
                                              onChange={(e) => setEditingCellValue(e.target.value)}
                                              onBlur={() => void commitCellEdit()}
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                  e.preventDefault();
                                                  void commitCellEdit();
                                                }
                                                if (e.key === "Escape") cancelCellEdit();
                                              }}
                                              className="h-6 w-full min-w-0 max-w-full rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                            >
                                               <option value=""></option>
                                               {options.map((opt) => (
                                                 <option key={opt} value={opt}>{opt}</option>
                                               ))}
                                             </select>
                                            ) : (
                                              <button
                                                type="button"
                                                disabled={productionReadOnly}
                                                onClick={() => startCellEdit(row, "partType")}
                                                className="inline-flex rounded-[8px] border px-2 py-[2px] text-[11px] font-medium disabled:opacity-60"
                                                style={{
                                                  borderColor: rowPartColor,
                                                  backgroundColor: rowPartColor,
                                                  color: rowPartTextColor,
                                                }}
                                              >
                                                {row.partType || "Unassigned"}
                                              </button>
                                            )}
                                        </td>
                                      );
                                    }
                                    if (col.key === "board") {
                                      const options = Array.from(new Set([row.board, ...cutlistBoardOptions].filter(Boolean)));
                                      return (
                                        <td
                                          key={`${row.id}_${col.label}`}
                                          className={`px-2 py-[3px] align-middle ${alignClass}`}
                                          onDoubleClick={() => startCellEdit(row, "board")}
                                          style={{ ...cutlistListColumnStyle("board"), color: groupTextColor }}
                                        >
                                          {editing ? (
                                            <BoardPillDropdown
                                              value={editingCellValue}
                                              options={options}
                                              disabled={productionReadOnly}
                                              bg="#FFFFFF"
                                              border="#94A3B8"
                                              text="#0F172A"
                                              size="compact"
                                              getSize={boardSizeFor}
                                              getLabel={boardDisplayLabel}
                                              onChange={(next) => {
                                                setEditingCellValue(next);
                                                void commitCellEdit(next);
                                              }}
                                            />
                                          ) : (
                                            <div className="inline-flex items-center gap-2">
                                              {boardSizeFor(row.board) && (
                                                <span
                                                  className="inline-flex h-5 min-w-[28px] items-center justify-center rounded-[999px] px-2 text-[10px] font-bold"
                                                  style={{ backgroundColor: darkenHex(color, 0.15), color: groupTextColor }}
                                                >
                                                  {boardSizeFor(row.board)}
                                                </span>
                                              )}
                                              <span>{boardDisplayLabel(row.board)}</span>
                                            </div>
                                          )}
                                        </td>
                                      );
                                    }
                                    if (col.key === "grain") {
                                      const rowBoardAllowsGrain = boardGrainFor(String(row.board ?? "").trim());
                                      return (
                                        <td
                                          key={`${row.id}_${col.label}`}
                                          className={`px-2 py-[3px] align-middle ${alignClass}`}
                                          onDoubleClick={() => {
                                            if (!rowBoardAllowsGrain) return;
                                            startCellEdit(row, "grain");
                                          }}
                                          style={{ ...cutlistListColumnStyle("grain"), color: groupTextColor }}
                                        >
                                          {!rowBoardAllowsGrain ? "" : editing ? (
                                            <BoardPillDropdown
                                              value={editingCellValue}
                                              options={grainDimensionOptionsForRow(row)}
                                              disabled={productionReadOnly}
                                              bg="#FFFFFF"
                                              border="#94A3B8"
                                              text="#0F172A"
                                              size="compact"
                                              getSize={() => ""}
                                              getLabel={(v) => v}
                                              onChange={(v) => {
                                                setEditingCellValue(v);
                                                void commitCellEdit(v);
                                              }}
                                            />
                                          ) : (
                                            row.grainValue || (row.grain ? "Yes" : "")
                                          )}
                                        </td>
                                      );
                                    }
                                    if (col.key === "height") {
                                      const rowIsDrawer = isDrawerPartType(row.partType);
                                      const isHeightGrainMatched = matchesGrainDimension(
                                        String(row.grainValue ?? ""),
                                        row.height,
                                        "height",
                                      );
                                      return (
                                        <td
                                          key={`${row.id}_${col.label}`}
                                          className={`px-2 py-[3px] align-middle ${alignClass}`}
                                          onDoubleClick={() => startCellEdit(row, "height")}
                                          style={{
                                            ...cutlistListColumnStyle("height"),
                                            color: groupTextColor,
                                            ...(isHeightGrainMatched ? { fontWeight: 700, textDecoration: "underline" } : {}),
                                          }}
                                        >
                                          {editing ? (
                                            rowIsDrawer ? (
                                              <DrawerHeightDropdown
                                                value={String(editingCellValue || "")}
                                                options={drawerHeightLetterOptions}
                                                compact
                                                title={cellWarn || undefined}
                                                className={cellWarnClass}
                                                bg={warningStyleForCell(row.id, key, { backgroundColor: "#FFFFFF", borderColor: "#94A3B8", color: "#0F172A" }).backgroundColor ?? "#FFFFFF"}
                                                border={warningStyleForCell(row.id, key, { backgroundColor: "#FFFFFF", borderColor: "#94A3B8", color: "#0F172A" }).borderColor ?? "#94A3B8"}
                                                text={warningStyleForCell(row.id, key, { backgroundColor: "#FFFFFF", borderColor: "#94A3B8", color: "#0F172A" }).color ?? "#0F172A"}
                                                onAdd={(token) => addEditingDrawerHeightToken(token)}
                                                onRemove={(token) => removeEditingDrawerHeightToken(token)}
                                                onOpenChange={(isOpen) => {
                                                  if (!isOpen) {
                                                    void commitCellEdit(editingCellValue);
                                                  }
                                                }}
                                              />
                                            ) : (
                                              <input
                                                autoFocus
                                                value={editingCellValue}
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                onChange={(e) => setEditingCellValue(numericOnlyText(e.target.value))}
                                                onBlur={() => void commitCellEdit()}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    void commitCellEdit();
                                                  }
                                                  if (e.key === "Escape") cancelCellEdit();
                                                }}
                                                className={`h-6 w-full rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A] ${alignClass}`}
                                              />
                                            )
                                          ) : (
                                            rowIsDrawer ? (
                                              <span className="block truncate whitespace-nowrap" title={String(row.height ?? "")}>
                                                {summarizeDrawerHeightTokens(String(row.height ?? "")) || String(row.height ?? "")}
                                              </span>
                                            ) : (
                                              String(row.height ?? "")
                                            )
                                          )}
                                        </td>
                                      );
                                    }
                                    if (col.key === "clashing") {
                                      const rowIsCabinetry = isCabinetryPartType(row.partType);
                                      return (
                                        <td
                                          key={`${row.id}_${col.label}`}
                                          className={`px-2 py-[3px] align-middle ${alignClass}`}
                                          onDoubleClick={() => startCellEdit(row, "clashing")}
                                          style={{ ...cutlistListColumnStyle("clashing"), color: groupTextColor }}
                                        >
                                          {editing ? (
                                            rowIsCabinetry ? (
                                              <div data-cutlist-cabinetry-edit={row.id} className="grid min-h-[78px] content-center gap-[1px] text-left">
                                                <div className="-mt-[2px] grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                  <span className="block pr-[3px] text-right text-[9px] font-bold leading-none">Fixed Shelf</span>
                                                  <input
                                                    autoFocus
                                                    value={editingFixedShelf}
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    onChange={(e) => {
                                                      const next = numericOnlyText(e.target.value);
                                                      editingFixedShelfRef.current = next;
                                                      setEditingFixedShelf(next);
                                                    }}
                                                    onBlur={(e) => onCabinetryShelfInputBlur(e, row.id)}
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        const nextRoot = e.currentTarget.closest(`[data-cutlist-cabinetry-edit="${row.id}"]`) as HTMLElement | null;
                                                        const nextTarget = nextRoot?.querySelector('[data-cutlist-drilling="fixed"] button') as HTMLButtonElement | null;
                                                        if (hasShelfQuantity(editingFixedShelf) && nextTarget) {
                                                          nextTarget.focus();
                                                          return;
                                                        }
                                                        void commitCellEdit();
                                                      }
                                                      if (e.key === "Escape") cancelCellEdit();
                                                    }}
                                                    className="h-[18px] w-full min-w-0 rounded-[5px] border border-[#94A3B8] bg-white px-1 text-[9px] text-[#0F172A]"
                                                  />
                                                </div>
                                                <div className="-mt-[2px] grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                  {hasShelfQuantity(editingFixedShelf) ? (
                                                    <>
                                                      <span className="inline-flex w-full items-center justify-end gap-[2px] pr-[3px] text-[9px] font-bold leading-none">
                                                        <DrillingArrowIcon color={groupTextColor} />
                                                        Drilling
                                                      </span>
                                                      <div data-cutlist-drilling="fixed" className="w-full min-w-0">
                                                        <BoardPillDropdown
                                                          value={editingFixedShelfDrilling}
                                                          options={DRILLING_OPTIONS}
                                                          disabled={productionReadOnly}
                                                          bg="#FFFFFF"
                                                          border="#94A3B8"
                                                          text="#0F172A"
                                                          size="compact"
                                                          className="!h-[18px] !rounded-[5px] !text-[9px]"
                                                          getSize={() => ""}
                                                          getLabel={(v) => v}
                                                          onChange={(v) => {
                                                            const next = normalizeDrillingValue(v);
                                                            editingFixedShelfDrillingRef.current = next;
                                                            setEditingFixedShelfDrilling(next);
                                                            window.setTimeout(() => {
                                                              void commitCellEdit();
                                                            }, 0);
                                                          }}
                                                        />
                                                      </div>
                                                    </>
                                                  ) : (
                                                    <>
                                                      <span></span>
                                                      <span></span>
                                                    </>
                                                  )}
                                                </div>
                                                <div className="grid h-[18px] grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                  <span className="block pr-[3px] text-right text-[9px] font-bold leading-none">Adjustable Shelf</span>
                                                  <input
                                                    value={editingAdjustableShelf}
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    onChange={(e) => {
                                                      const next = numericOnlyText(e.target.value);
                                                      editingAdjustableShelfRef.current = next;
                                                      setEditingAdjustableShelf(next);
                                                    }}
                                                    onBlur={(e) => onCabinetryShelfInputBlur(e, row.id)}
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        const nextRoot = e.currentTarget.closest(`[data-cutlist-cabinetry-edit="${row.id}"]`) as HTMLElement | null;
                                                        const nextTarget = nextRoot?.querySelector('[data-cutlist-drilling="adjustable"] button') as HTMLButtonElement | null;
                                                        if (hasShelfQuantity(editingAdjustableShelf) && nextTarget) {
                                                          nextTarget.focus();
                                                          return;
                                                        }
                                                        void commitCellEdit();
                                                      }
                                                      if (e.key === "Escape") cancelCellEdit();
                                                    }}
                                                    className="h-[18px] w-full min-w-0 rounded-[5px] border border-[#94A3B8] bg-white px-1 text-[9px] text-[#0F172A]"
                                                  />
                                                </div>
                                                <div className="-mt-[2px] grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                  {hasShelfQuantity(editingAdjustableShelf) ? (
                                                    <>
                                                      <span className="inline-flex w-full items-center justify-end gap-[2px] pr-[3px] text-[9px] font-bold leading-none">
                                                        <DrillingArrowIcon color={groupTextColor} />
                                                        Drilling
                                                      </span>
                                                      <div data-cutlist-drilling="adjustable" className="w-full min-w-0">
                                                        <BoardPillDropdown
                                                          value={editingAdjustableShelfDrilling}
                                                          options={DRILLING_OPTIONS}
                                                          disabled={productionReadOnly}
                                                          bg="#FFFFFF"
                                                          border="#94A3B8"
                                                          text="#0F172A"
                                                          size="compact"
                                                          className="!h-[18px] !rounded-[5px] !text-[9px]"
                                                          getSize={() => ""}
                                                          getLabel={(v) => v}
                                                          onChange={(v) => {
                                                            const next = normalizeDrillingValue(v);
                                                            editingAdjustableShelfDrillingRef.current = next;
                                                            setEditingAdjustableShelfDrilling(next);
                                                            window.setTimeout(() => {
                                                              void commitCellEdit();
                                                            }, 0);
                                                          }}
                                                        />
                                                      </div>
                                                    </>
                                                  ) : (
                                                    <>
                                                      <span></span>
                                                      <span></span>
                                                    </>
                                                  )}
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="grid grid-cols-2 gap-1">
                                                <BoardPillDropdown
                                                  value={editingClashLeft}
                                                  options={CLASH_LEFT_OPTIONS}
                                                  disabled={productionReadOnly || isDrawerPartType(row.partType)}
                                                  bg="#FFFFFF"
                                                  border="#94A3B8"
                                                  text="#0F172A"
                                                  size="compact"
                                                  matchDrawerArrow={isDrawerPartType(row.partType)}
                                                  getSize={() => ""}
                                                  getLabel={(v) => v}
                                                  onChange={(next) => setEditingClashLeft(next)}
                                                />
                                                <BoardPillDropdown
                                                  value={editingClashRight}
                                                  options={CLASH_RIGHT_OPTIONS}
                                                  disabled={productionReadOnly || isDrawerPartType(row.partType)}
                                                  bg="#FFFFFF"
                                                  border="#94A3B8"
                                                  text="#0F172A"
                                                  size="compact"
                                                  matchDrawerArrow={isDrawerPartType(row.partType)}
                                                  getSize={() => ""}
                                                  getLabel={(v) => v}
                                                  onChange={(next) => {
                                                    setEditingClashRight(next);
                                                    window.setTimeout(() => {
                                                      void commitCellEdit();
                                                    }, 0);
                                                  }}
                                                />
                                              </div>
                                            )
                                          ) : (
                                            rowIsCabinetry
                                              ? (
                                                <div className="grid min-h-[78px] content-center gap-[1px] text-left text-[9px]">
                                                <div className="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                    <span className="block pr-[3px] text-right font-bold">Fixed Shelf</span>
                                                    <span>{row.fixedShelf || ""}</span>
                                                  </div>
                                                  {hasShelfQuantity(row.fixedShelf) && (
                                                    <div className="-mt-[2px] grid h-[18px] grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                      <span className="inline-flex w-full items-center justify-end gap-[2px] pr-[3px] font-bold">
                                                        <DrillingArrowIcon color={groupTextColor} />
                                                        Drilling
                                                      </span>
                                                      <span>{normalizeDrillingValue(row.fixedShelfDrilling)}</span>
                                                    </div>
                                                  )}
                                                  <div className="grid h-[18px] grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                    <span className="block pr-[3px] text-right font-bold">Adjustable Shelf</span>
                                                    <span>{row.adjustableShelf || ""}</span>
                                                  </div>
                                                  {hasShelfQuantity(row.adjustableShelf) && (
                                                    <div className="-mt-[2px] grid h-[18px] grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                      <span className="inline-flex w-full items-center justify-end gap-[2px] pr-[3px] font-bold">
                                                        <DrillingArrowIcon color={groupTextColor} />
                                                        Drilling
                                                      </span>
                                                      <span>{normalizeDrillingValue(row.adjustableShelfDrilling)}</span>
                                                    </div>
                                                  )}
                                                </div>
                                              )
                                              : row.clashing
                                          )}
                                        </td>
                                      );
                                    }
                                    if (col.key === "information") {
                                      const infoLines = informationLinesFromValue(String(row.information ?? ""));
                                      const editingInfoLines = informationLinesFromValue(editingCellValue);
                                      const mainEditingInfoLines = editingInfoLines;
                                      return (
                                        <td
                                          key={`${row.id}_${col.label}`}
                                          className={`px-2 py-[3px] align-middle ${alignClass}`}
                                          onDoubleClick={() => startCellEdit(row, key, 0)}
                                          style={{ ...cutlistListColumnStyle(key), color: groupTextColor }}
                                        >
                                          {editing ? (
                                            <div className="grid gap-[2px]">
                                              {mainEditingInfoLines.map((line, idx) => (
                                                <div key={`${row.id}_edit_info_${idx}`} className="flex items-center gap-[3px]">
                                                  <button
                                                    type="button"
                                                    data-cutlist-info-edit-row={row.id}
                                                    onClick={() => (idx === 0 ? onEditingAddInformationLine() : onEditingRemoveInformationLine(idx))}
                                                    className={
                                                      idx === 0
                                                        ? "inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#A9DDBF] bg-[#EAF8F0] text-[#1F8A4C] hover:bg-[#DDF2E7]"
                                                        : "inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                                                    }
                                                  >
                                                    {idx === 0 ? <Plus size={16} className="mx-auto" strokeWidth={2.8} /> : <X size={15} className="mx-auto" strokeWidth={2.8} />}
                                                  </button>
                                                  <input
                                                    autoFocus={
                                                      editingInfoFocusLine?.rowId === row.id
                                                        ? editingInfoFocusLine.lineIndex === idx
                                                        : idx === 0
                                                    }
                                                    data-cutlist-info-edit-row={row.id}
                                                    value={line}
                                                    onChange={(e) => onEditingInformationLineChange(idx, e.target.value)}
                                                    onBlur={onInformationInputBlur}
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        void commitCellEdit();
                                                      }
                                                      if (e.key === "Escape") cancelCellEdit();
                                                    }}
                                                    className="h-7 w-full rounded-[6px] border border-[#94A3B8] bg-white px-2 text-[11px] text-[#0F172A]"
                                                  />
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            spillInfoToSubRows ? (
                                              <div className="space-y-[2px]">
                                                {mainInfoLines.map((line, idx) => (
                                                  <div key={`${row.id}_main_info_${idx}`} className="leading-[1.2]">
                                                    {line}
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <div className="space-y-[2px]">
                                                {infoLines.map((line, idx) => (
                                                  <div key={`${row.id}_info_inline_${idx}`} className="leading-[1.2]">
                                                    {line}
                                                  </div>
                                                ))}
                                              </div>
                                            )
                                          )}
                                        </td>
                                      );
                                    }
                                    const value = String(row[col.key] ?? "");
                                    const isGrainMatchedDimension =
                                      (key === "height" && matchesGrainDimension(String(row.grainValue ?? ""), row.height, "height")) ||
                                      (key === "width" && matchesGrainDimension(String(row.grainValue ?? ""), row.width, "width")) ||
                                      (key === "depth" && matchesGrainDimension(String(row.grainValue ?? ""), row.depth, "depth"));
                                    const drawerTextboxLift =
                                      isDrawerPartType(row.partType) && (key === "width" || key === "depth" || key === "quantity");
                                    return (
                                      <td
                                        key={`${row.id}_${col.label}`}
                                        className={`px-2 py-[3px] align-middle ${alignClass}`}
                                        onDoubleClick={() => startCellEdit(row, key)}
                                        style={{
                                          ...cutlistListColumnStyle(key),
                                          color: groupTextColor,
                                          ...(isGrainMatchedDimension ? { fontWeight: 700, textDecoration: "underline" } : {}),
                                        }}
                                      >
                                        {editing ? (
                                          <input
                                            autoFocus
                                            value={editingCellValue}
                                            inputMode={isNumericCutlistInputKey(key) ? "numeric" : undefined}
                                            pattern={isNumericCutlistInputKey(key) ? "[0-9]*" : undefined}
                                            onChange={(e) => setEditingCellValue(isNumericCutlistInputKey(key) ? numericOnlyText(e.target.value) : e.target.value)}
                                            onBlur={() => void commitCellEdit()}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                void commitCellEdit();
                                              }
                                              if (e.key === "Escape") cancelCellEdit();
                                            }}
                                            style={drawerTextboxLift ? { transform: "translateY(-2px)" } : undefined}
                                            className={`h-6 w-full rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A] ${alignClass}`}
                                          />
                                        ) : (
                                          isGrainMatchedDimension ? (
                                            <span>{value}</span>
                                          ) : (
                                            value
                                          )
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                                {rowIsCabinetry && cabinetryOpen && cabinetryPieces.map((piece, pieceIdx) => (
                                  <tr
                                    key={`${row.id}_cab_${piece.key}`}
                                    data-cutlist-subrow-parent={row.id}
                                    data-cutlist-subrow-key={piece.key}
                                    className="border-t"
                                    style={{ backgroundColor: palette.headerBg, color: groupTextColor, borderTopColor: palette.divider }}
                                  >
                                    <td className="px-2 py-[3px] align-middle text-center text-[10px] font-bold" style={{ width: 78, minWidth: 78, maxWidth: 78 }}>
                                      
                                    </td>
                                    {showRoomColumnInList && (
                                      <td className="px-2 py-[3px] align-middle text-[11px]" style={{ width: 150, minWidth: 150, color: groupTextColor }}>
                                        {row.room}
                                      </td>
                                    )}
                                    {cutlistListColumnDefs.map((col) => {
                                      const key = col.key as CutlistEditableField;
                                      const alignClass = cutlistCellAlignClass(key);
                                      const infoLineIndex = mainInfoCount + pieceIdx;
                                      const editingThisInfoCell = col.key === "information" && isEditing(row.id, "information");
                                      let value = "";
                                      if (col.key === "partType") value = "";
                                      if (col.key === "board") value = "";
                                      if (col.key === "name") value = piece.partName;
                                      if (col.key === "height") value = piece.height;
                                      if (col.key === "width") value = piece.width;
                                      if (col.key === "depth") value = piece.depth;
                                      if (col.key === "quantity") value = piece.quantity;
                                      if (col.key === "clashing") value = joinClashing(piece.clashLeft, piece.clashRight);
                                      if (col.key === "information") value = overflowInfoLines[pieceIdx] ?? "";
                                      const pieceGrainValue = cabinetryPieceGrainValue(row, piece);
                                      if (col.key === "grain") value = pieceGrainValue || (row.grain ? "Yes" : "");
                                      const isPieceGrainMatchedDimension =
                                        (key === "height" && matchesGrainDimension(pieceGrainValue, piece.height, "height")) ||
                                        (key === "width" && matchesGrainDimension(pieceGrainValue, piece.width, "width")) ||
                                        (key === "depth" && matchesGrainDimension(pieceGrainValue, piece.depth, "depth"));
                                      return (
                                        <td
                                          key={`${row.id}_${piece.key}_${col.key}`}
                                          className={`px-2 py-[3px] align-middle text-[11px] ${alignClass}`}
                                          onDoubleClick={() => {
                                            if (col.key !== "information") return;
                                            startCellEdit(row, "information", infoLineIndex);
                                          }}
                                          style={{
                                            ...cutlistListColumnStyle(key),
                                            color: groupTextColor,
                                            ...(isPieceGrainMatchedDimension ? { fontWeight: 700, textDecoration: "underline" } : {}),
                                          }}
                                        >
                                          {editingThisInfoCell ? (
                                            ""
                                          ) : (
                                            value
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                                {rowIsDrawer && drawerOpen && drawerPieces.map((piece, pieceIdx) => (
                                  <tr
                                    key={`${row.id}_${piece.key}`}
                                    data-cutlist-subrow-parent={row.id}
                                    data-cutlist-subrow-key={piece.key}
                                    className="border-t"
                                    style={{ backgroundColor: palette.headerBg, color: groupTextColor, borderTopColor: palette.divider }}
                                  >
                                    <td className="px-2 py-[3px] align-middle text-center text-[10px] font-bold" style={{ width: 78, minWidth: 78, maxWidth: 78 }}></td>
                                    {showRoomColumnInList && (
                                      <td className="px-2 py-[3px] align-middle text-[11px]" style={{ width: 150, minWidth: 150, color: groupTextColor }}>
                                        {row.room}
                                      </td>
                                    )}
                                    {cutlistListColumnDefs.map((col) => {
                                      const key = col.key as CutlistEditableField;
                                      const alignClass = cutlistCellAlignClass(key);
                                      const infoLineIndex = mainInfoCount + pieceIdx;
                                      const editingThisInfoCell = col.key === "information" && isEditing(row.id, "information");
                                      let value = "";
                                      if (col.key === "partType") value = "";
                                      if (col.key === "board") value = "";
                                      if (col.key === "name") value = piece.partName;
                                      if (col.key === "height") value = piece.height;
                                      if (col.key === "width") value = piece.width;
                                      if (col.key === "depth") value = piece.depth;
                                      if (col.key === "quantity") value = piece.quantity;
                                      if (col.key === "clashing") value = joinClashing(piece.clashLeft, piece.clashRight);
                                      if (col.key === "information") value = overflowInfoLines[pieceIdx] ?? "";
                                      if (col.key === "grain") value = "";
                                      return (
                                        <td
                                          key={`${row.id}_${piece.key}_${col.key}`}
                                          className={`px-2 py-[3px] align-middle text-[11px] ${alignClass}`}
                                          onDoubleClick={() => {
                                            if (col.key !== "information") return;
                                            startCellEdit(row, "information", infoLineIndex);
                                          }}
                                          style={{ ...cutlistListColumnStyle(key), color: groupTextColor }}
                                        >
                                          {editingThisInfoCell ? (
                                            ""
                                          ) : (
                                            value
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                                </Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                          )}
                        </section>
                      );
                    })}
                  </div>
                </div>
              </section>
            </div>
          </div>
          {addRoomModalPortal}
        </div>
      </ProtectedRoute>
    );
  }

  if (isCncFullscreen) {
    return (
      <ProtectedRoute>
        <div className="h-[100dvh] overflow-hidden bg-[var(--bg-app)]">
          <div
            className="z-[95] flex h-[56px] items-center justify-between border-b border-[#D7DEE8] bg-white pl-4 pr-3 md:pl-5 md:pr-3"
            style={{ position: "fixed", top: 0, left: 0, right: 0 }}
          >
            <div className="inline-flex items-center gap-2 text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">
              <Cpu size={14} />
              <span>CNC Cutlist</span>
              <span className="text-[#6B7280]">|</span>
              <span className="truncate text-[#334155]">{project?.name || "Project"}</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={onPrintCnc}
                className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-[12px] font-bold text-[#334155] hover:bg-[#F8FAFC]"
              >
                <Printer size={14} />
                Print
              </button>
              <div className="relative" ref={cncExportMenuRef}>
                <button
                  type="button"
                  onClick={() => setCncExportMenuOpen((prev) => !prev)}
                  className="inline-flex h-9 w-[130px] items-center justify-between rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-[12px] font-bold text-[#334155] hover:bg-[#F8FAFC]"
                >
                  <span className="inline-flex items-center gap-2">
                    <FileSpreadsheet size={14} />
                    Export
                  </span>
                  <ChevronDown size={14} />
                </button>
                {cncExportMenuOpen && (
                  <div className="absolute right-0 top-[42px] z-[120] w-[130px] overflow-hidden rounded-[10px] border border-[#D5DEE8] bg-white shadow-[0_12px_30px_rgba(15,23,42,0.14)]">
                    <button
                      type="button"
                      onClick={() => {
                        onExportCncXlsx();
                        setCncExportMenuOpen(false);
                      }}
                      className="flex h-9 w-full items-center px-3 text-left text-[12px] font-semibold text-[#334155] hover:bg-[#F8FAFC]"
                    >
                      .xlsx
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onExportCncPdf();
                        setCncExportMenuOpen(false);
                      }}
                      className="flex h-9 w-full items-center border-t border-[#E4EAF2] px-3 text-left text-[12px] font-semibold text-[#334155] hover:bg-[#F8FAFC]"
                    >
                      .pdf
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => void onSaveAndBackFromCnc()}
                className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#C8DAFF] bg-[#EAF1FF] px-3 text-[12px] font-bold text-[#24589A] hover:bg-[#DFE9FF]"
              >
                <ArrowLeft size={14} />
                Save & Back
              </button>
            </div>
          </div>
          <div
            className="mt-[56px] grid h-[calc(100dvh-56px)] items-start gap-0 p-0"
            style={{ gridTemplateColumns: "minmax(0, 1fr) 360px" }}
          >
            <section className="h-full min-h-0 overflow-auto pl-3 pr-3 pb-3">
              <div className="space-y-3 px-0 py-2">
                {cncRowsByBoardNonCab.length === 0 && cncCabinetCards.length === 0 && (
                  <div className="rounded-[10px] border border-dashed border-[#D8DEE8] bg-[#F8FAFC] px-3 py-8 text-center text-[12px] font-semibold text-[#667085]">
                    No visible CNC rows.
                  </div>
                )}
                {cncRowsByBoardNonCab.length > 0 && (() => {
                  let runningId = 0;
                  let lastIdKey = "";
                  let stripeIndex = -1;
                  let lastStripeKey = "";
                  return cncRowsByBoardNonCab.map((group) => {
                    const showBoardGrainHelper = boardGrainFor(group.boardKey);
                    return (
                    <section key={group.boardKey} className="overflow-hidden rounded-[9px] border border-[#111111] bg-[#111111]">
                      <div
                        className="border-b px-3 py-2 text-[16px] font-semibold"
                        style={{ borderColor: "#111111", backgroundColor: "#111111", color: "#FFFFFF" }}
                      >
                        <span>{group.boardLabel}</span>
                        {showBoardGrainHelper && (
                          <span className="float-right whitespace-nowrap text-[12px] font-normal text-white">
                            <span className="underline font-bold">Underlined</span> Dimension has grain along it.
                          </span>
                        )}
                      </div>
                      <div className="overflow-auto bg-white">
                        <table className="w-full table-fixed text-left text-[12px]">
                          <colgroup>
                            <col style={{ width: 50 }} />
                            <col style={{ width: cncRoomColumnPx }} />
                            <col style={{ width: 75 }} />
                            <col style={{ width: cncPartNameColumnPx }} />
                            <col style={{ width: 75 }} />
                            <col style={{ width: 75 }} />
                            <col style={{ width: 75 }} />
                            <col style={{ width: 75 }} />
                            <col style={{ width: 92 }} />
                            {showCncGrainColumn && <col style={{ width: 75 }} />}
                            <col style={{ width: "auto" }} />
                          </colgroup>
                          <thead style={{ backgroundColor: companyThemeColor, color: cncHeaderTextColor }}>
                            <tr>
                              <th className="w-[50px] px-2 py-2 text-center text-[13px]" style={{ backgroundColor: companyThemeColor, color: cncHeaderTextColor, borderBottom: "1px solid #111111" }}>ID</th>
                              <th className="px-2 py-2 text-[13px]" style={{ backgroundColor: companyThemeColor, color: cncHeaderTextColor, borderBottom: "1px solid #111111" }}>Room</th>
                              <th className="w-[75px] px-2 py-2 text-[13px]" style={{ backgroundColor: companyThemeColor, color: cncHeaderTextColor, borderBottom: "1px solid #111111" }}>Part Type</th>
                              <th className="px-2 py-2 text-[13px]" style={{ backgroundColor: companyThemeColor, color: cncHeaderTextColor, borderBottom: "1px solid #111111" }}>Part Name</th>
                              <th className="w-[75px] px-2 py-2 text-center text-[13px]" style={{ backgroundColor: companyThemeColor, color: cncHeaderTextColor, borderBottom: "1px solid #111111" }}>Height</th>
                              <th className="w-[75px] px-2 py-2 text-center text-[13px]" style={{ backgroundColor: companyThemeColor, color: cncHeaderTextColor, borderBottom: "1px solid #111111" }}>Width</th>
                              <th className="w-[75px] px-2 py-2 text-center text-[13px]" style={{ backgroundColor: companyThemeColor, color: cncHeaderTextColor, borderBottom: "1px solid #111111" }}>Depth</th>
                              <th className="w-[75px] px-2 py-2 text-center text-[13px]" style={{ backgroundColor: companyThemeColor, color: cncHeaderTextColor, borderBottom: "1px solid #111111" }}>Qty</th>
                              <th className="px-2 py-2 text-center text-[13px]" style={{ backgroundColor: companyThemeColor, color: cncHeaderTextColor, borderBottom: "1px solid #111111" }}>Clashing</th>
                              {showCncGrainColumn && <th className="px-2 py-2 text-center text-[13px]" style={{ backgroundColor: companyThemeColor, color: cncHeaderTextColor, borderBottom: "1px solid #111111" }}>Grain</th>}
                              <th className="px-2 py-2 text-[13px]" style={{ backgroundColor: companyThemeColor, color: cncHeaderTextColor, borderBottom: "1px solid #111111" }}>Information</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.rows.map((row, idx) => {
                              const prevRow = idx > 0 ? group.rows[idx - 1] : null;
                              const partTypeForDisplay =
                                isCabinetryPartType(row.partType) && (row as CncDisplayRow).cncCabinetryRowKind && (row as CncDisplayRow).cncCabinetryRowKind !== "main"
                                  ? ""
                                  : String(row.partType || "");
                              const cabinetryKind = (row as CncDisplayRow).cncCabinetryRowKind;
                              const isCabinetryMainRow = isCabinetryPartType(row.partType) && cabinetryKind === "main";
                              const isCabinetryShelfRow = isCabinetryPartType(row.partType) && cabinetryKind && cabinetryKind !== "main";
                              const isDrawerRow = isDrawerPartType(row.partType);
                              const drawerSourceKey = isDrawerRow
                                ? String((row as CncDisplayRow).sourceRowId || row.id)
                                : "";
                              const idKey = (isCabinetryPartType(row.partType) || isDrawerRow)
                                ? String((row as CncDisplayRow).sourceRowId || row.id)
                                : String(row.id);
                              if (idKey !== lastIdKey) {
                                runningId += 1;
                                lastIdKey = idKey;
                              }
                              const stripeKey = (isCabinetryPartType(row.partType) || isDrawerRow)
                                ? String((row as CncDisplayRow).sourceRowId || row.id)
                                : String(row.id);
                              if (stripeKey !== lastStripeKey) {
                                stripeIndex += 1;
                                lastStripeKey = stripeKey;
                              }
                              const prevIdKey = prevRow
                                ? ((isCabinetryPartType(prevRow.partType) || isDrawerPartType(prevRow.partType))
                                    ? String((prevRow as CncDisplayRow).sourceRowId || prevRow.id)
                                    : String(prevRow.id))
                                : "";
                              const isContinuationOfSameCabinetry =
                                Boolean(prevRow) &&
                                isCabinetryPartType(row.partType) &&
                                isCabinetryPartType(String(prevRow?.partType || "")) &&
                                idKey === prevIdKey;
                              const isContinuationOfSameDrawer =
                                Boolean(prevRow) &&
                                isDrawerRow &&
                                isDrawerPartType(String(prevRow?.partType || "")) &&
                                drawerSourceKey === String((prevRow as CncDisplayRow).sourceRowId || prevRow?.id || "");
                              const isFirstDrawerRowOfGroup = isDrawerRow && !isContinuationOfSameDrawer;
                              let drawerRowSpan = 1;
                              if (isFirstDrawerRowOfGroup) {
                                for (let look = idx + 1; look < group.rows.length; look += 1) {
                                  const nextRow = group.rows[look];
                                  if (!isDrawerPartType(String(nextRow.partType || ""))) break;
                                  const nextKey = String((nextRow as CncDisplayRow).sourceRowId || nextRow.id);
                                  if (nextKey !== drawerSourceKey) break;
                                  drawerRowSpan += 1;
                                }
                              }
                              const hideIdentityCells = isCabinetryShelfRow || (isDrawerRow && !isFirstDrawerRowOfGroup);
                              const identityRowSpan = isCabinetryMainRow ? 3 : (isFirstDrawerRowOfGroup ? drawerRowSpan : 1);
                              const hidePartTypeCell = isDrawerRow && !isFirstDrawerRowOfGroup;
                              const partTypeRowSpan = isFirstDrawerRowOfGroup ? drawerRowSpan : 1;
                              const partColor = partTypeColors[row.partType || "Unassigned"] ?? "#CBD5E1";
                              const partText = isLightHex(partColor) ? "#111827" : "#F8FAFC";
                              const rowBoardHasGrain = boardGrainFor(String(row.board || "").trim());
                              const isHeightGrainMatch =
                                rowBoardHasGrain && matchesGrainDimension(String(row.grainValue ?? ""), String(row.height ?? ""), "height");
                              const isWidthGrainMatch =
                                rowBoardHasGrain && matchesGrainDimension(String(row.grainValue ?? ""), String(row.width ?? ""), "width");
                              const isDepthGrainMatch =
                                rowBoardHasGrain && matchesGrainDimension(String(row.grainValue ?? ""), String(row.depth ?? ""), "depth");
                              return (
                                <tr
                                  key={`${group.boardKey}_${row.id}_${idx}`}
                                  className={(isContinuationOfSameCabinetry || isContinuationOfSameDrawer) ? "border-0" : "border-t border-[#E4E7EE]"}
                                  style={{ backgroundColor: stripeIndex % 2 === 1 ? "#F6F8FB" : "#FFFFFF" }}
                                >
                                  {!hideIdentityCells && (
                                    <td
                                      rowSpan={identityRowSpan}
                                      className="px-2 py-[5px] text-center align-middle text-[#334155]"
                                    >
                                      {runningId}
                                    </td>
                                  )}
                                  {!hideIdentityCells && (
                                    <td
                                      rowSpan={identityRowSpan}
                                      className="px-2 py-[5px] align-middle text-[#334155]"
                                    >
                                      {row.room || ""}
                                    </td>
                                  )}
                                  {!hidePartTypeCell && (
                                    <td rowSpan={partTypeRowSpan} className="w-[75px] px-2 py-[5px] align-middle">
                                      {partTypeForDisplay ? (
                                        <span
                                          className="inline-flex max-w-[71px] truncate rounded-[7px] px-2 py-[1px] text-[11px] font-semibold"
                                          style={{ backgroundColor: partColor, color: partText }}
                                        >
                                          {partTypeForDisplay}
                                        </span>
                                      ) : null}
                                    </td>
                                  )}
                                  <td className="px-2 py-[5px] font-semibold text-[#0F172A]">{row.name || ""}</td>
                                  <td className="px-2 py-[5px] text-center text-[#334155]" style={isHeightGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : undefined}>{row.height || ""}</td>
                                  <td className="px-2 py-[5px] text-center text-[#334155]" style={isWidthGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : undefined}>{row.width || ""}</td>
                                  <td className="px-2 py-[5px] text-center text-[#334155]" style={isDepthGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : undefined}>{row.depth || ""}</td>
                                  <td className="px-2 py-[5px] text-center font-bold text-[#0F172A]">{row.quantity || ""}</td>
                                  <td className="px-2 py-[5px] text-center text-[#334155]">{joinClashing(row.clashLeft ?? "", row.clashRight ?? "") || row.clashing || ""}</td>
                                  {showCncGrainColumn && (
                                    <td className="px-2 py-[5px] text-center text-[#334155]">{row.grainValue || (row.grain ? "Yes" : "")}</td>
                                  )}
                                  <td className="px-2 py-[5px] text-[#334155]">
                                    {informationLinesFromValue(String(row.information || "")).map((line, infoIdx) => (
                                      <div key={`cnc-info-${row.id}-${idx}-${infoIdx}`}>{line}</div>
                                    ))}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  );
                  });
                })()}
                {cncCabinetCards.length > 0 && (
                  <section className="rounded-[9px] border border-[#111111] bg-[#111111]">
                    <div className="overflow-hidden rounded-[8px]">
                    <div className="border-b border-[#111111] bg-[#111111] px-3 py-2 text-[16px] font-semibold text-white">
                      <span>Cabinets</span>
                      {productionForm.boardTypes.some((row) => Boolean(row.grain)) && (
                        <span className="float-right whitespace-nowrap text-[12px] font-normal text-white">
                          <span className="underline font-bold">Underlined</span> Dimension has grain along it.
                        </span>
                      )}
                    </div>
                    <div className="divide-y divide-[#111111] bg-white">
                    {cncCabinetCards.map(({ row, displayId, boardLabel, sizeLabel, fixedShelf, adjustableShelf, infoLines, cabinetryPieces, widthMm, heightMm, depthMm, thicknessMm }, idx) => {
                      const renderDimsWithGrain = (
                        height: string,
                        width: string,
                        depth: string,
                        grainValue: string,
                      ) => {
                        const h = String(height || "").trim();
                        const w = String(width || "").trim();
                        const d = String(depth || "").trim();
                        const parts: Array<{ key: "height" | "width" | "depth"; value: string }> = [];
                        if (h) parts.push({ key: "height", value: h });
                        if (w) parts.push({ key: "width", value: w });
                        if (d) parts.push({ key: "depth", value: d });
                        if (parts.length === 0) return "";
                        return (
                          <>
                            {parts.map((part, partIdx) => (
                              <span key={`dim_${part.key}_${partIdx}`}>
                                {partIdx > 0 ? " x " : ""}
                                <span
                                  style={
                                    matchesGrainDimension(grainValue, part.value, part.key)
                                      ? { fontWeight: 700, textDecoration: "underline" }
                                      : undefined
                                  }
                                >
                                  {part.value}
                                </span>
                              </span>
                            ))}
                          </>
                        );
                      };
                      const renderPieceDimsWithQty = (piece: CabinetryDerivedPiece | undefined, qtyMultiplier = 1) => {
                        if (!piece) return "";
                        const qty = Number.parseInt(String(piece.quantity || "0"), 10) || 0;
                        const finalQty = qty > 0 ? qty * Math.max(1, qtyMultiplier) : 0;
                        const pieceGrainValue = cabinetryPieceGrainValue(row, piece);
                        return (
                          <>
                            {renderDimsWithGrain(piece.height, piece.width, piece.depth, pieceGrainValue)}
                            {finalQty > 0 ? ` (x${finalQty})` : ""}
                          </>
                        );
                      };
                      return (
                      <article
                        key={`cnc_cab_card_${row.id}`}
                        className="bg-white"
                        style={{ backgroundColor: idx % 2 === 1 ? "#F6F8FB" : "#FFFFFF" }}
                      >
                          <div className="grid grid-cols-[80px_1fr] border-b border-[#E4E7EE] text-[12px]">
                            <p className="border-r border-[#E4E7EE] px-3 py-2 text-[#0F172A]">{displayId}</p>
                            <p className="px-3 py-2 font-semibold text-[#0F172A]">{row.name || "-"}</p>
                          </div>
                          <div className="flex items-stretch gap-3 px-3">
                            <CabinetIsoPreview
                              widthMm={widthMm}
                              heightMm={heightMm}
                              depthMm={depthMm}
                              thicknessMm={thicknessMm}
                              fixedShelfCount={fixedShelf}
                              adjustableShelfCount={adjustableShelf}
                            />
                            <div className="grid min-w-0 flex-1 self-stretch grid-cols-2">
                              <div className="min-w-0 self-stretch border-l border-[#E4E7EE] pt-2 pb-0 text-[12px] text-[#334155]">
                                <div className="grid grid-cols-[120px_1fr] items-start border-b border-[#E4E7EE] px-3 py-1">
                                  <p className="font-bold text-[#0F172A]">Material</p>
                                  <p>{boardLabel || "-"}</p>
                                </div>
                                <div className="grid grid-cols-[120px_1fr] items-start border-b border-[#E4E7EE] px-3 py-1">
                                  <p className="font-bold text-[#0F172A]">Quantity</p>
                                  <p>{row.quantity || ""}</p>
                                </div>
                                <div className="grid grid-cols-[120px_1fr] items-start border-b border-[#E4E7EE] px-3 py-1">
                                  <p className="font-bold text-[#0F172A]">
                                    Size <span className="italic">(H x W x D)</span>
                                  </p>
                                  <p>{renderDimsWithGrain(row.height, row.width, row.depth, String(row.grainValue ?? "")) || sizeLabel || "-"}</p>
                                </div>
                                <div className="grid grid-cols-[120px_1fr] items-start border-b border-[#E4E7EE] px-3 py-1">
                                  <p className="font-bold text-[#0F172A]">{fixedShelf === 1 ? "Fixed Shelf" : "Fixed Shelves"}</p>
                                  <p>
                                    {fixedShelf > 0
                                      ? (
                                        <>
                                          {fixedShelf}{" "}
                                          <span className="italic">
                                            ({String(normalizeDrillingValue(row.fixedShelfDrilling || "No")).toLowerCase()} drilling)
                                          </span>
                                        </>
                                      )
                                      : ""}
                                  </p>
                                </div>
                                <div className="grid grid-cols-[120px_1fr] items-start px-3 py-1">
                                  <p className="font-bold text-[#0F172A]">{adjustableShelf === 1 ? "Adjustable Shelf" : "Adjustable Shelves"}</p>
                                  <p>
                                    {adjustableShelf > 0
                                      ? (
                                        <>
                                          {adjustableShelf}{" "}
                                          <span className="italic">
                                            ({String(normalizeDrillingValue(row.adjustableShelfDrilling || "No")).toLowerCase()} drilling)
                                          </span>
                                        </>
                                      )
                                      : ""}
                                  </p>
                                </div>
                              </div>
                              <div className="min-w-0 self-stretch border-l border-[#E4E7EE] pt-2 pb-0 text-[12px] text-[#334155]">
                                <div className="grid grid-cols-[160px_1fr] items-start border-b border-[#E4E7EE] px-3 py-1">
                                  <p className="font-bold text-[#0F172A]">Top / Bottom</p>
                                  <p>{renderPieceDimsWithQty(cabinetryPieces.top ?? cabinetryPieces.bottom, 2)}</p>
                                </div>
                                <div className="grid grid-cols-[160px_1fr] items-start border-b border-[#E4E7EE] px-3 py-1">
                                  <p className="font-bold text-[#0F172A]">Left / Right Side</p>
                                  <p>{renderPieceDimsWithQty(cabinetryPieces.left_side ?? cabinetryPieces.right_side, 2)}</p>
                                </div>
                                <div className="grid grid-cols-[160px_1fr] items-start border-b border-[#E4E7EE] px-3 py-1">
                                  <p className="font-bold text-[#0F172A]">Back</p>
                                  <p>{renderPieceDimsWithQty(cabinetryPieces.back)}</p>
                                </div>
                                <div className="grid grid-cols-[160px_1fr] items-start border-b border-[#E4E7EE] px-3 py-1">
                                  <p className="font-bold text-[#0F172A]">Fixed Shelf</p>
                                  <p>{renderPieceDimsWithQty(cabinetryPieces.fixed_shelf)}</p>
                                </div>
                                <div className="grid grid-cols-[160px_1fr] items-start px-3 py-1">
                                  <p className="font-bold text-[#0F172A]">Adjustable Shelf</p>
                                  <p>{renderPieceDimsWithQty(cabinetryPieces.adjustable_shelf)}</p>
                                </div>
                              </div>
                              <div className="col-span-2 min-w-0 border-l border-t border-[#E4E7EE] px-3 py-2 text-[12px] text-[#334155]">
                                <div className="grid grid-cols-[120px_1fr] items-start">
                                  <p className="font-bold text-[#0F172A]">Information</p>
                                  <div className="space-y-1">
                                    {infoLines.map((line, idx) => (
                                      <p key={`cnc_cab_info_inline_${row.id}_${idx}`} className="min-h-[16px]">
                                        {line}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                      </article>
                    );
                    })}
                    </div>
                    </div>
                  </section>
                )}
              </div>
            </section>
            <section
              className="self-start min-h-0 overflow-y-auto border-b border-l border-[#D7DEE8] bg-white"
              style={{ position: "fixed", right: 0, top: 56, width: 360, height: "calc(100dvh - 56px)" }}
            >
              <div className="flex h-[46px] items-center justify-between border-b border-[#DCE3EC] px-3">
                <p className="text-[13px] font-medium text-[#111827]">Edit Visibility</p>
                <button
                  type="button"
                  disabled={productionReadOnly}
                  onClick={() => void onShowAllCncRows()}
                  className="rounded-[8px] border border-[#D8DEE8] bg-white px-2 py-1 text-[11px] font-bold text-[#334155] disabled:opacity-55"
                >
                  Show All
                </button>
              </div>
              <div className="p-3">
                <input
                  value={cncVisibilitySearch}
                  onChange={(e) => setCncVisibilitySearch(e.target.value)}
                  placeholder="Search pieces..."
                  className="h-8 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                />
              </div>
              <div className="px-3 pb-3">
                <div className="space-y-1">
                  {cncSidebarGroups.map((group) => {
                    const color = partTypeColors[group.partType] ?? "#CBD5E1";
                    const textColor = isLightHex(color) ? "#0F172A" : "#F8FAFC";
                    const partTypeCollapseKey = `cnc:pt:${group.partType}`;
                    const collapsed = Boolean(cncCollapsedGroups[partTypeCollapseKey]);
                    const totalQty = group.rows.reduce(
                      (sum, row) => sum + Math.max(1, Number.parseInt(String(row.quantity || "1"), 10) || 1),
                      0,
                    );
                    const visibleCount = group.rows.reduce((sum, row) => {
                      const checked = typeof cncVisibilityMap[row.id] === "boolean"
                        ? cncVisibilityMap[row.id]
                        : true;
                      return sum + (checked ? 1 : 0);
                    }, 0);
                    const allChecked = group.rows.length > 0 && visibleCount === group.rows.length;
                    const someChecked = visibleCount > 0 && !allChecked;
                    return (
                      <div key={`cnc_group_${group.partType}`} className="space-y-1">
                        <div
                          className="flex items-center justify-between rounded-[8px] pl-[5px] text-[11px] font-extrabold"
                          style={{ backgroundColor: color, color: textColor }}
                        >
                          <span style={{ paddingLeft: 5 }}>{group.partType} ({totalQty})</span>
                          <div className="ml-auto inline-flex items-center">
                            <span className="inline-flex h-7 items-center self-center pr-2">
                              <input
                                type="checkbox"
                                checked={allChecked}
                                ref={(el) => {
                                  if (el) el.indeterminate = someChecked;
                                }}
                                disabled={productionReadOnly || group.rows.length === 0}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  group.rows.forEach((row) => {
                                    void onToggleCncVisibility(row.id, checked);
                                  });
                                }}
                                className="h-4 w-4 accent-[#12345B]"
                                title={allChecked ? "Untick all in part type" : "Tick all in part type"}
                              />
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleCncGroup(partTypeCollapseKey)}
                              className="inline-flex h-7 w-8 items-center justify-center rounded-r-[8px] border-l border-black/15 hover:bg-black/10"
                              style={{ color: textColor }}
                              title={collapsed ? "Expand part type" : "Collapse part type"}
                            >
                              {collapsed ? <Plus size={14} strokeWidth={2.6} /> : <Minus size={14} strokeWidth={2.6} />}
                            </button>
                          </div>
                        </div>
                        {!collapsed && group.rows.map((row) => {
                          const checked = typeof cncVisibilityMap[row.id] === "boolean"
                            ? cncVisibilityMap[row.id]
                            : true;
                          const rowColor = partTypeColors[row.partType] ?? "#CBD5E1";
                          const rowBg = lightenHex(rowColor, 0.72);
                          return (
                            <label
                              key={`cnc_vis_${row.id}`}
                              className="flex items-start gap-2 rounded-[8px] border px-2 py-2"
                              style={{
                                backgroundColor: rowBg,
                                borderColor: darkenHex(rowColor, 0.12),
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={productionReadOnly}
                                onChange={(e) => void onToggleCncVisibility(row.id, e.target.checked)}
                                className="mt-[2px] h-4 w-4"
                              />
                              <span className="flex min-w-0 flex-1 items-start justify-between gap-2 text-[11px] text-[#334155]">
                                <span className="min-w-0">
                                  <span className="block truncate font-bold text-[#0F172A]">{row.name || "Part"}</span>
                                  <span className="mt-[1px] block truncate text-[10px]">{row.room || "-"}</span>
                                </span>
                                <span className="shrink-0 text-right">
                                  <span className="block pt-[1px] font-bold text-[#0F172A]">
                                    {Math.max(1, Number.parseInt(String(row.quantity || "1"), 10) || 1)}
                                  </span>
                                  <span className="mt-[1px] block text-[10px] text-[#475569]">
                                    {boardDisplayLabel(row.board) || "No board"}
                                  </span>
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                  {cncSourceRows.length === 0 && (
                    <p className="rounded-[10px] border border-dashed border-[#D8DEE8] px-3 py-4 text-center text-[12px] font-semibold text-[#64748B]">
                      No cutlist rows yet.
                    </p>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  if (isNestingFullscreen) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-[var(--bg-app)]">
          <div className="flex h-[56px] items-center justify-between border-b border-[#D7DEE8] bg-white px-4 md:px-5">
            <div className="inline-flex items-center gap-2 text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">
              <GitBranch size={14} />
              <span>Nesting</span>
              <span className="text-[#6B7280]">|</span>
              <span className="truncate text-[#334155]">{project?.name || "Project"}</span>
            </div>
            <button
              type="button"
              onClick={() => void onSaveAndBackFromNesting()}
              className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#C8DAFF] bg-[#EAF1FF] px-3 text-[12px] font-bold text-[#24589A] hover:bg-[#DFE9FF]"
            >
              <ArrowLeft size={14} />
              Save & Back
            </button>
          </div>
          <div
            className="grid min-h-[calc(100dvh-56px)] items-start gap-3 p-3"
            style={{ gridTemplateColumns: "minmax(0, 1fr) 360px" }}
          >
            <section className="min-h-0 overflow-auto">
              <div className="space-y-3">
                  {nestingBoardLayouts.length === 0 && (
                    <div className="rounded-[10px] border border-dashed border-[#D8DEE8] bg-[#F8FAFC] px-3 py-8 text-center text-[12px] font-semibold text-[#667085]">
                      No visible nesting pieces. Toggle visibility on the right panel.
                    </div>
                  )}
                  <div className="grid grid-cols-4 gap-3">
                    {nestingBoardLayouts.map((group) => {
                      const partsCount = group.sheets.reduce((sum, sheet) => sum + sheet.placements.length, 0);
                      const boardHasGrain = boardGrainFor(group.boardKey);
                      const grainArrowRotation = group.sheetWidth >= group.sheetHeight ? 0 : 90;
                      const grainArrowPoints: Array<[number, number]> = [
                        [8, 14], [22, 14], [36, 14], [50, 14], [64, 14], [78, 14], [92, 14],
                        [15, 34], [29, 34], [43, 34], [57, 34], [71, 34], [85, 34],
                        [8, 54], [22, 54], [36, 54], [50, 54], [64, 54], [78, 54], [92, 54],
                        [15, 74], [29, 74], [43, 74], [57, 74], [71, 74], [85, 74],
                        [8, 90], [22, 90], [36, 90], [50, 90], [64, 90], [78, 90], [92, 90],
                      ];
                      return (
                        <div key={group.boardKey} className="overflow-hidden rounded-[12px] border border-[#D7DEE8] bg-[#F5F7FA]">
                          <div className="border-b border-[#DCE3EC] bg-[#EEF2F6] px-[5px] py-1">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="shrink-0 rounded-[999px] bg-[#DEE6F3] px-2 py-[1px] text-[11px] font-bold text-[#45658A]">
                                {group.sheetWidth}x{group.sheetHeight}
                              </span>
                              <span className="inline-flex shrink-0 min-w-[74px] justify-end rounded-[999px] bg-[#E9EEF6] px-2 py-[1px] text-[11px] font-bold text-[#395174]">
                                {group.sheets.length} sheets
                              </span>
                            </div>
                            <div className="flex items-start justify-between gap-2 px-2">
                              <p className="min-w-0 flex-1 truncate leading-[1.1] text-[11px] font-bold text-[#1F2F46]">{group.boardLabel}</p>
                              <span className="inline-flex shrink-0 min-w-[74px] justify-end leading-[1.1] text-right text-[11px] font-bold text-[#4A5D76]">
                                {formatPartCount(partsCount)}
                              </span>
                            </div>
                          </div>
                            <div className="max-h-[calc(100dvh-280px)] space-y-2 overflow-auto p-2">
                              {group.sheets.map((sheet) => (
                                <div key={`${group.boardKey}_sheet_${sheet.index}`} className="p-0">
                                  <p className="mb-1 text-[11px] font-bold text-[#6B7D94]">Sheet {sheet.index}</p>
                                <div
                                  className="relative z-0 isolate w-full cursor-pointer overflow-hidden rounded-[4px] border border-[#D4DCE8] bg-white"
                                  style={{ aspectRatio: `${group.sheetWidth}/${group.sheetHeight}`, minHeight: 120 }}
                                  onClick={() => setNestingSheetPreview({ boardKey: group.boardKey, sheetIndex: sheet.index })}
                                >
                                    {sheet.placements.map((placement) => {
                                      const c = partTypeColors[placement.piece.partType] ?? "#CBD5E1";
                                      const t = isLightHex(c) ? "#0F172A" : "#F8FAFC";
                                      const marginX = (group.sheetWidth - group.innerW) / 2;
                                      const marginY = (group.sheetHeight - group.innerH) / 2;
                                      return (
                                        <div
                                          key={placement.piece.id}
                                          className="absolute z-[10] cursor-pointer border px-[6px] py-[1px] text-[10px] font-semibold leading-tight"
                                          onMouseEnter={(e) => {
                                            const base = partTypeColors[placement.piece.partType] ?? "#CBD5E1";
                                            setNestingTooltip({
                                              text: nestingPieceTooltip(
                                                String(placement.piece.row.parentName || placement.piece.name || "Part"),
                                                String(placement.piece.name || "Part"),
                                                String(placement.piece.room || placement.piece.row.room || "-"),
                                                placement.w,
                                                placement.h,
                                              ),
                                              x: e.clientX + 14,
                                              y: e.clientY + 14,
                                              bg: lightenHex(base, 0.72),
                                              border: darkenHex(base, 0.18),
                                              textColor: isLightHex(base) ? "#0F172A" : "#F8FAFC",
                                            });
                                          }}
                                          onMouseMove={(e) => {
                                            setNestingTooltip((prev) =>
                                              prev
                                                ? { ...prev, x: e.clientX + 14, y: e.clientY + 14 }
                                                : prev,
                                            );
                                          }}
                                          onMouseLeave={() => setNestingTooltip(null)}
                                          style={{
                                            left: `${((marginX + placement.x) / group.sheetWidth) * 100}%`,
                                            top: `${((marginY + placement.y) / group.sheetHeight) * 100}%`,
                                            width: `${(placement.w / group.sheetWidth) * 100}%`,
                                            height: `${(placement.h / group.sheetHeight) * 100}%`,
                                            backgroundColor: lightenHex(c, 0.18),
                                            borderColor: darkenHex(c, 0.22),
                                            color: t,
                                          }}
                                        >
                                          {(isCabinetryPartType(placement.piece.partType) || isDrawerPartType(placement.piece.partType)) && placement.piece.row.parentName ? (
                                            <>
                                              <span className="block truncate text-[10px] leading-tight opacity-85" style={{ paddingLeft: 4 }}>{placement.piece.row.parentName}</span>
                                              <span className="block truncate text-[10px] leading-tight" style={{ paddingLeft: 4 }}>{placement.piece.name}</span>
                                            </>
                                          ) : (
                                            <span className="block truncate" style={{ paddingLeft: 4 }}>{placement.piece.name}</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {boardHasGrain && (
                                      <div className="pointer-events-none absolute inset-0 z-[30]">
                                        {grainArrowPoints.map(([x, y], idx) => (
                                          <img
                                            key={`${group.boardKey}_sheet_${sheet.index}_grain_${idx}`}
                                            src="/arrow-right.png"
                                            alt=""
                                            aria-hidden="true"
                                            className="absolute opacity-55"
                                            style={{
                                              left: `${x}%`,
                                              top: `${y}%`,
                                              width: "15px",
                                              height: "15px",
                                              transform: `translate(-50%, -50%) rotate(${grainArrowRotation}deg)`,
                                              filter: "drop-shadow(0 0 1px rgba(255,255,255,0.75))",
                                            }}
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {partsCount === 0 && (
                                <div className="rounded-[8px] border border-dashed border-[#D8DEE8] bg-white px-2 py-4 text-center text-[11px] font-semibold text-[#7A8798]">
                                  No parts for this board
                                </div>
                              )}
                            </div>
                        </div>
                      );
                    })}
                  </div>
              </div>
            </section>

            <aside className="self-start min-h-0 overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white h-[calc(100dvh-80px)]">
              <div className="flex h-[46px] items-center justify-between border-b border-[#DCE3EC] px-3">
                <p className="text-[13px] font-medium text-[#111827]">Part Rows</p>
                <button
                  type="button"
                  disabled={productionReadOnly}
                  onClick={() => void onShowAllNestingRows()}
                  className="rounded-[8px] border border-[#D8DEE8] bg-white px-2 py-1 text-[11px] font-bold text-[#334155] disabled:opacity-55"
                >
                  Show All
                </button>
              </div>
              <div className="p-3">
                <input
                  value={nestingSearch}
                  onChange={(e) => setNestingSearch(e.target.value)}
                  placeholder="Search pieces..."
                  className="h-8 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                />
              </div>
              <div className="h-[calc(100%-94px)] overflow-auto px-3 pb-3">
                <div className="space-y-1">
                  {nestingSidebarGroups.map((group) => {
                    const color = partTypeColors[group.partType] ?? "#CBD5E1";
                    const textColor = isLightHex(color) ? "#0F172A" : "#F8FAFC";
                    const partTypeCollapseKey = `pt:${group.partType}`;
                    const collapsed = Boolean(nestingCollapsedGroups[partTypeCollapseKey]);
                    const totalQty = group.rows.reduce(
                      (sum, row) => sum + Math.max(1, Number.parseInt(String(row.quantity || "1"), 10) || 1),
                      0,
                    );
                    const visibleCount = group.rows.reduce((sum, row) => {
                      const checked = typeof nestingVisibilityMap[row.id] === "boolean"
                        ? nestingVisibilityMap[row.id]
                        : row.includeInNesting !== false;
                      return sum + (checked ? 1 : 0);
                    }, 0);
                    const allChecked = group.rows.length > 0 && visibleCount === group.rows.length;
                    const someChecked = visibleCount > 0 && !allChecked;
                    return (
                      <div key={`nest_group_${group.partType}`} className="space-y-1">
                        <div
                          className="flex items-center justify-between rounded-[8px] pl-[5px] text-[11px] font-extrabold"
                          style={{ backgroundColor: color, color: textColor }}
                        >
                          <span style={{ paddingLeft: 5 }}>{group.partType} ({totalQty})</span>
                          <div className="ml-auto inline-flex items-center">
                            <span className="inline-flex h-7 items-center self-center pr-2">
                              <input
                                type="checkbox"
                                checked={allChecked}
                                ref={(el) => {
                                  if (el) el.indeterminate = someChecked;
                                }}
                                disabled={productionReadOnly || group.rows.length === 0}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  group.rows.forEach((row) => {
                                    void onToggleNestingVisibility(row.id, checked);
                                  });
                                }}
                                className="h-4 w-4 accent-[#12345B]"
                                title={allChecked ? "Untick all in part type" : "Tick all in part type"}
                              />
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleNestingGroup(partTypeCollapseKey)}
                              className="inline-flex h-7 w-8 items-center justify-center rounded-r-[8px] border-l border-black/15 hover:bg-black/10"
                              style={{ color: textColor }}
                              title={collapsed ? "Expand part type" : "Collapse part type"}
                            >
                              {collapsed ? <Plus size={14} strokeWidth={2.6} /> : <Minus size={14} strokeWidth={2.6} />}
                            </button>
                          </div>
                        </div>
                        {!collapsed && group.rows.map((row) => {
                          const checked = typeof nestingVisibilityMap[row.id] === "boolean"
                            ? nestingVisibilityMap[row.id]
                            : row.includeInNesting !== false;
                          const rowColor = partTypeColors[row.partType] ?? "#CBD5E1";
                          const rowBg = lightenHex(rowColor, 0.72);
                          return (
                            <label
                              key={`nest_vis_${row.id}`}
                              className="flex items-start gap-2 rounded-[8px] border px-2 py-2"
                              style={{
                                backgroundColor: rowBg,
                                borderColor: darkenHex(rowColor, 0.12),
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={productionReadOnly}
                                onChange={(e) => void onToggleNestingVisibility(row.id, e.target.checked)}
                                className="mt-[2px] h-4 w-4"
                              />
                              <span className="flex min-w-0 flex-1 items-start justify-between gap-2 text-[11px] text-[#334155]">
                                <span className="min-w-0">
                                  <span className="block truncate font-bold text-[#0F172A]">{row.name || "Part"}</span>
                                  <span className="mt-[1px] block truncate text-[10px]">{row.room || "-"}</span>
                                </span>
                                <span className="shrink-0 text-right">
                                  <span className="block pt-[1px] font-bold text-[#0F172A]">
                                    {Math.max(1, Number.parseInt(String(row.quantity || "1"), 10) || 1)}
                                  </span>
                                  <span className="mt-[1px] block text-[10px] text-[#475569]">
                                    {boardDisplayLabel(row.board) || "No board"}
                                  </span>
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                  {cutlistRows.length === 0 && (
                    <p className="rounded-[10px] border border-dashed border-[#D8DEE8] px-3 py-4 text-center text-[12px] font-semibold text-[#64748B]">
                      No cutlist rows yet.
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </div>
          {selectedNestingSheet && (
            <div
              className="fixed inset-0 z-[200] p-8"
              style={{
                backgroundColor: "rgba(2, 6, 23, 0.32)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
              }}
              onClick={() => {
                setNestingSheetPreview(null);
                setNestingPreviewHoverPieceId(null);
                setNestingTooltip(null);
              }}
            >
              <div
                className="mx-auto mt-[6vh] flex flex-col overflow-hidden rounded-[14px] border border-[#CFD8E6] bg-white shadow-[0_24px_65px_rgba(15,23,42,0.42)]"
                style={{
                  width: "fit-content",
                  maxWidth: "88vw",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex h-[46px] items-center justify-between border-b border-[#DCE3EC] bg-[#F7FAFF] px-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-[#12345B]">{selectedNestingSheet.group.boardLabel}</p>
                    <p className="text-[11px] font-semibold text-[#64748B]">Sheet {selectedNestingSheet.sheet.index}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNestingSheetPreview(null);
                      setNestingPreviewHoverPieceId(null);
                      setNestingTooltip(null);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#D7DEE8] bg-white text-[#334155] hover:bg-[#F1F5F9]"
                    title="Close preview"
                  >
                    <X size={16} strokeWidth={2.4} />
                  </button>
                </div>
                <div className="overflow-hidden p-3">
                  <div
                    className="relative mx-auto overflow-hidden border border-[#D4DCE8] bg-white"
                    style={{
                      width: selectedNestingSheetViewportWidth,
                      height: selectedNestingSheetViewportHeight,
                    }}
                  >
                    {selectedNestingSheet.sheet.placements.map((placement) => {
                      const hoverPlacementKey = `${placement.piece.id}__${placement.x}__${placement.y}__${placement.w}__${placement.h}`;
                      const c = partTypeColors[placement.piece.partType] ?? "#CBD5E1";
                      const t = isLightHex(c) ? "#0F172A" : "#F8FAFC";
                      const showWidthDimension = placement.w >= 120;
                      const showHeightDimension = placement.h >= 120;
                      const marginX = (selectedNestingSheet.group.sheetWidth - selectedNestingSheet.group.innerW) / 2;
                      const marginY = (selectedNestingSheet.group.sheetHeight - selectedNestingSheet.group.innerH) / 2;
                      return (
                        <div
                          key={`preview_${placement.piece.id}_${placement.x}_${placement.y}`}
                          className="group absolute z-[10] border px-[7px] py-[2px] text-[11px] font-semibold leading-tight"
                          onMouseEnter={(e) => {
                            setNestingPreviewHoverPieceId(hoverPlacementKey);
                            const base = partTypeColors[placement.piece.partType] ?? "#CBD5E1";
                            setNestingTooltip({
                              text: nestingPieceTooltip(
                                String(placement.piece.row.parentName || placement.piece.name || "Part"),
                                String(placement.piece.name || "Part"),
                                String(placement.piece.room || placement.piece.row.room || "-"),
                                placement.w,
                                placement.h,
                              ),
                              x: e.clientX + 14,
                              y: e.clientY + 14,
                              bg: lightenHex(base, 0.72),
                              border: darkenHex(base, 0.18),
                              textColor: isLightHex(base) ? "#0F172A" : "#F8FAFC",
                            });
                          }}
                          onMouseMove={(e) => {
                            setNestingTooltip((prev) =>
                              prev
                                ? { ...prev, x: e.clientX + 14, y: e.clientY + 14 }
                                : prev,
                            );
                          }}
                          onMouseLeave={() => {
                            setNestingPreviewHoverPieceId(null);
                            setNestingTooltip(null);
                          }}
                          style={{
                            left: `${((marginX + placement.x) / selectedNestingSheet.group.sheetWidth) * 100}%`,
                            top: `${((marginY + placement.y) / selectedNestingSheet.group.sheetHeight) * 100}%`,
                            width: `${(placement.w / selectedNestingSheet.group.sheetWidth) * 100}%`,
                            height: `${(placement.h / selectedNestingSheet.group.sheetHeight) * 100}%`,
                            backgroundColor: lightenHex(c, 0.18),
                            borderColor: darkenHex(c, 0.22),
                            color: t,
                            zIndex: nestingPreviewHoverPieceId === hoverPlacementKey ? 20 : 10,
                            boxShadow:
                              nestingPreviewHoverPieceId === hoverPlacementKey
                                ? "0 0 0 2px rgba(15,23,42,0.55), 0 0 0 3px rgba(255,255,255,0.9)"
                                : "none",
                          }}
                        >
                          <div
                            className="absolute inset-0 z-[120] items-center justify-center"
                            style={{ display: nestingPreviewHoverPieceId === hoverPlacementKey ? "flex" : "none" }}
                          >
                            <button
                              type="button"
                              onMouseEnter={() => setNestingPreviewHoverPieceId(hoverPlacementKey)}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                jumpToCutlistFromDerivedRowId(String(placement.piece.row.id || ""));
                              }}
                              className="inline-flex h-6 min-w-[48px] px-2 items-center justify-center rounded-[6px] text-[10px] font-bold shadow-sm backdrop-blur-[1px]"
                              style={{
                                backgroundColor: lightenHex(c, 0.52),
                                border: `1px solid ${darkenHex(c, 0.2)}`,
                                color: "#000000",
                              }}
                              title="Edit in cutlist"
                            >
                              Edit
                            </button>
                          </div>
                          {showWidthDimension && nestingPreviewHoverPieceId !== hoverPlacementKey && (
                            <span
                              className="pointer-events-none absolute"
                              style={{ left: "50%", top: "2px", transform: "translateX(-50%)", zIndex: 40 }}
                            >
                              <span
                                className="inline-block rounded-[4px] px-1 text-[10px] font-bold"
                                style={{ color: t, backgroundColor: "rgba(15,23,42,0.18)" }}
                              >
                                {Math.round(placement.w)}
                              </span>
                            </span>
                          )}
                          {showHeightDimension && nestingPreviewHoverPieceId !== hoverPlacementKey && (
                            <span
                              className="pointer-events-none absolute top-1/2 rounded-[4px] px-1 text-[10px] font-bold"
                              style={{
                                color: t,
                                backgroundColor: "rgba(15,23,42,0.18)",
                                left: "-2px",
                                transform: "translateY(-50%) rotate(270deg)",
                                transformOrigin: "center",
                              }}
                            >
                              {Math.round(placement.h)}
                            </span>
                          )}
                          {(isCabinetryPartType(placement.piece.partType) || isDrawerPartType(placement.piece.partType)) && placement.piece.row.parentName ? (
                            <span className="block truncate" style={{ marginTop: showWidthDimension ? 12 : 0 }}>
                              <span className="block truncate text-[10px] leading-tight opacity-85" style={{ paddingLeft: 4 }}>{placement.piece.row.parentName}</span>
                              <span className="block truncate text-[10px] leading-tight" style={{ paddingLeft: 4 }}>{placement.piece.name}</span>
                            </span>
                          ) : (
                            <span className="block truncate" style={{ marginTop: showWidthDimension ? 12 : 0, paddingLeft: 4 }}>
                              {placement.piece.name}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {boardGrainFor(selectedNestingSheet.group.boardKey) && (
                      <div className="pointer-events-none absolute inset-0 z-[30]" style={{ zIndex: 999 }}>
                        {[
                          [8, 14], [22, 14], [36, 14], [50, 14], [64, 14], [78, 14], [92, 14],
                          [15, 34], [29, 34], [43, 34], [57, 34], [71, 34], [85, 34],
                          [8, 54], [22, 54], [36, 54], [50, 54], [64, 54], [78, 54], [92, 54],
                          [15, 74], [29, 74], [43, 74], [57, 74], [71, 74], [85, 74],
                          [8, 90], [22, 90], [36, 90], [50, 90], [64, 90], [78, 90], [92, 90],
                        ].map(([x, y], idx) => (
                          <img
                            key={`preview_grain_${idx}`}
                            src="/arrow-right.png"
                            alt=""
                            aria-hidden="true"
                            className="absolute opacity-55"
                            style={{
                              left: `${x}%`,
                              top: `${y}%`,
                              width: "15px",
                              height: "15px",
                              transform: `translate(-50%, -50%) rotate(${selectedNestingSheet.group.sheetWidth >= selectedNestingSheet.group.sheetHeight ? 0 : 90}deg)`,
                              zIndex: 1000,
                              filter: "drop-shadow(0 0 1px rgba(255,255,255,0.75))",
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedNestingSheetStats && (
                    <div className="mt-3 mx-auto rounded-[10px] border border-[#DCE3EC] bg-[#F8FAFC] p-3 text-[12px]" style={{ width: selectedNestingSheetViewportWidth }}>
                      <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.7px] text-[#12345B]">Sheet Stats</p>
                      <div
                        className="items-stretch text-[#334155]"
                        style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 24px minmax(0,1fr)" }}
                      >
                        <div className="min-w-0 space-y-1.5 pr-[10px]">
                          <div className="flex items-center justify-between"><span>Used:</span><span className="font-bold">{selectedNestingSheetStats.usedPct.toFixed(1)}%</span></div>
                          <div className="flex items-center justify-between"><span>Parts on sheet:</span><span className="font-bold">{selectedNestingSheetStats.partCount}</span></div>
                          <div className="flex items-center justify-between gap-2"><span>Largest Part:</span><span className="truncate font-bold">{selectedNestingSheetStats.largest ? `${selectedNestingSheetStats.largest.piece.name} (${Math.round(selectedNestingSheetStats.largest.w)} x ${Math.round(selectedNestingSheetStats.largest.h)})` : "-"}</span></div>
                        </div>
                        <div aria-hidden="true" className="self-stretch border-l-2 border-[#64748B]" />
                        <div className="min-w-0 space-y-1.5 pl-[10px]">
                          <div className="flex items-center justify-between"><span>Wastage:</span><span className="font-bold">{selectedNestingSheetStats.wastagePct.toFixed(1)}%</span></div>
                          <div className="flex items-center justify-between"><span>Sheet Area:</span><span className="font-bold">{selectedNestingSheetStats.sheetAreaM2.toFixed(3)} m2</span></div>
                          <div className="flex items-center justify-between"><span>Board Size:</span><span className="font-bold">{Math.round(selectedNestingSheet.group.sheetWidth)} x {Math.round(selectedNestingSheet.group.sheetHeight)}</span></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {nestingTooltip && (
            <div
              className="pointer-events-none fixed z-[5000] max-w-[320px] rounded-[6px] border px-2 py-1 text-[10px] font-medium shadow-lg"
              style={{
                left: nestingTooltip.x,
                top: nestingTooltip.y,
                backgroundColor: nestingTooltip.bg,
                borderColor: nestingTooltip.border,
                color: "#000000",
              }}
            >
              <pre className="m-0 whitespace-pre font-mono leading-[1.35]">{nestingTooltip.text}</pre>
            </div>
          )}
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <AppShell>
        <div className="space-y-4">
          <div className="-mx-4 -mt-4 bg-white md:-mx-5">
          <div className="border-b border-[#D7DEE8]">
            <div className="px-4 pb-[10px] pt-4 md:px-5">
            <Link href="/dashboard" className="mb-2 hidden items-center gap-1 text-[14px] font-semibold text-[#6E88AA] lg:inline-flex">
              <ArrowLeft size={15} />
              Back to Projects
            </Link>
            <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-start md:gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[32px] font-medium leading-none text-[#1A1D23] md:text-[42px]">{project.name}</h1>
                  {projectTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => void onDeleteTag(tag)}
                      disabled={!canEditTags}
                      className="inline-flex items-center gap-1 rounded-[8px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[2px] text-[12px] font-semibold text-[#7B8798] hover:bg-[#FDECEC] hover:text-[#B42318] disabled:cursor-not-allowed disabled:opacity-70"
                      title="Delete tag"
                    >
                      <Tag size={11} />
                      {tag}
                    </button>
                  ))}
                  {projectTags.length < 5 && canEditTags && (
                    <>
                      {isTagInputOpen && (
                        <div className="relative">
                          <input
                            autoFocus
                            value={tagInput}
                            onFocus={() => setShowTagSuggestions(true)}
                            onBlur={() => window.setTimeout(() => setShowTagSuggestions(false), 120)}
                            onChange={(e) => {
                              setTagInput(e.target.value);
                              setShowTagSuggestions(true);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void onAddTag();
                              }
                              if (e.key === "Escape") {
                                setTagInput("");
                                setShowTagSuggestions(false);
                                setIsTagInputOpen(false);
                              }
                            }}
                            placeholder="Tag"
                            className="h-7 w-[120px] rounded-[8px] border border-[#D6DEE9] bg-white px-2 text-[12px] text-[#334155] outline-none"
                          />
                          {showTagSuggestions && filteredTagSuggestions.length > 0 && (
                            <div className="absolute left-0 top-[calc(100%+2px)] z-30 max-h-[220px] w-[220px] overflow-auto rounded-[8px] border border-[#D6DEE9] bg-white p-1 shadow-[0_12px_28px_rgba(15,23,42,0.14)]">
                              {filteredTagSuggestions.map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => void onAddTagValue(tag)}
                                  className="block w-full rounded-[6px] px-2 py-1 text-left text-[12px] font-semibold text-[#334155] hover:bg-[#EEF2F7]"
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (!isTagInputOpen) {
                            setIsTagInputOpen(true);
                            setShowTagSuggestions(true);
                            return;
                          }
                          void onAddTag();
                        }}
                        disabled={isSavingTags}
                        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[8px] border border-[#D6DEE9] bg-[#EEF2F7] text-[#64748B] hover:bg-[#E2E8F0] disabled:opacity-60"
                      >
                        <Plus size={14} />
                      </button>
                    </>
                  )}
                </div>
                <p className="pt-2 text-[13px] text-[#8A97A8]">Client: {project.customer || "-"}</p>
                <p className="text-[13px] text-[#8A97A8]">Created: {project.createdByName || "Unknown"}</p>
                <p className="text-[13px] text-[#8A97A8]">
                  Assigned: {projectAssignedMember?.displayName || project.assignedToName || project.assignedTo || "Unassigned"}
                </p>
              </div>

              <div className="w-full text-left md:w-auto md:text-right">
                <div className="flex items-center gap-2 md:justify-end">
                  <button
                    type="button"
                    onClick={() => void onDeleteProject()}
                    disabled={isDeleting || !canDeleteProject}
                    className="h-8 rounded-[10px] border border-[#F7C9CC] bg-[#FDECEC] px-4 text-[12px] font-bold text-[#B42318] hover:bg-[#FADCE0] disabled:opacity-60"
                  >
                    {deleteArmed ? "Confirm Delete" : "Delete"}
                  </button>
                  <button
                    data-status-trigger="true"
                    type="button"
                    disabled={isSavingStatus || !canEditStatus}
                    onClick={(e) => {
                      if (projectStatusMenuPos) {
                        setProjectStatusMenuPos(null);
                        return;
                      }
                      const trigger = e.currentTarget as HTMLButtonElement;
                      const rect = trigger.getBoundingClientRect();
                      const estimatedMenuHeight = Math.max(156, statusOptions.length * 34);
                      const hasRoomBelow = rect.bottom + estimatedMenuHeight <= window.innerHeight - 8;
                      const hasRoomAbove = rect.top - estimatedMenuHeight >= 8;
                      const shouldOpenUp = !hasRoomBelow && hasRoomAbove;
                      const viewportWidth = Math.max(
                        120,
                        document.documentElement?.clientWidth || window.innerWidth,
                      );
                      const menuWidth = Math.min(
                        Math.max(120, Math.round(rect.width)),
                        Math.max(120, viewportWidth - 16),
                      );
                      const clampedLeft = Math.min(Math.max(8, rect.left), viewportWidth - menuWidth - 8);
                      setProjectStatusMenuPos({
                        left: clampedLeft,
                        top: shouldOpenUp ? Math.max(8, rect.top - estimatedMenuHeight - 4) : rect.bottom + 4,
                        width: menuWidth,
                      });
                    }}
                    className="inline-flex h-8 min-w-[90px] items-center justify-center rounded-[10px] px-3 text-[12px] font-bold disabled:opacity-60"
                    style={projectStatusPillStyle(project.statusLabel || "New")}
                    aria-label="Project status"
                    title="Change project status"
                  >
                    {isSavingStatus ? "Saving..." : project.statusLabel || "New"}
                  </button>
                </div>
                <p className="pt-2 text-[13px] text-[#8A97A8] md:pt-3">Created: {dashboardStyleDate(project.createdAt)}</p>
                <p className="text-[13px] text-[#8A97A8]">Modified: {dashboardStyleDate(project.updatedAt)}</p>
              </div>
            </div>
            </div>
          </div>

          <div className="border-b border-[#D7DEE8]">
            <div className="px-4 md:px-5">
              <div className="grid grid-cols-4 items-end gap-1 sm:-mx-1 sm:flex sm:gap-4 sm:overflow-x-auto sm:px-1 md:mx-0 md:gap-10 md:px-2">
              {tabItemsWithAccess.map((item) => {
                const active = resolvedTab === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    title={"title" in item ? item.title : undefined}
                    disabled={"disabled" in item ? item.disabled : false}
                    onClick={() => onChangeTab(item.value)}
                    className={`w-full border-b-2 pb-[10px] pt-[10px] text-center text-[16px] font-semibold transition sm:w-auto sm:shrink-0 sm:whitespace-nowrap sm:text-left sm:text-[18px] md:text-[20px] ${
                      active
                        ? "border-[#7395BD] text-[#1F3654]"
                        : "border-transparent text-[#6D82A1] hover:text-[#45638A]"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {item.label}
                  </button>
                );
              })}
              </div>
            </div>
          </div>
          </div>

          {project &&
            projectStatusMenuPos &&
            createPortal(
              <div
                data-status-menu="true"
                className="fixed overflow-hidden rounded-[10px] border border-[#D7DEE8] bg-white shadow-[0_20px_44px_rgba(15,23,42,0.30),0_6px_14px_rgba(15,23,42,0.18)]"
                style={{
                  left: projectStatusMenuPos.left,
                  top: projectStatusMenuPos.top,
                  width: projectStatusMenuPos.width,
                  zIndex: 2147483647,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {statusOptions.map((option) => {
                  const active = String(project.statusLabel || "").trim().toLowerCase() === option.toLowerCase();
                  const rowColor = projectStatusColorByName.get(String(option || "").trim().toLowerCase()) || "#64748B";
                  return (
                    <button
                      key={`${project.id}_${option}`}
                      type="button"
                      disabled={isSavingStatus}
                      onClick={() => void onChangeStatus(option)}
                      className="block w-full border-b border-[#EEF2F7] px-3 py-2 text-center text-[12px] font-semibold text-white disabled:opacity-55"
                      style={{
                        backgroundColor: rowColor,
                        filter: active ? "brightness(0.96)" : "brightness(1)",
                      }}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>,
              document.body,
            )}

          {!!lockMessage && (
            <div className="rounded-[10px] border border-[#F7C9CC] bg-[#FDECEC] px-3 py-2 text-[12px] font-semibold text-[#B42318]">
              {lockMessage}
            </div>
          )}

          {productionUnlockRemainingSeconds > 0 && (
            <div className="rounded-[10px] border border-[#D6DEE9] bg-[#EEF2F7] px-3 py-2 text-[12px] font-semibold text-[#334155]">
              Production unlocked for you: {formatUnlockTimer(productionUnlockRemainingSeconds)} remaining
            </div>
          )}

          {!productionAccess.view && resolvedTab === "general" && (
            <div className="rounded-[10px] border border-[#E4E6EC] bg-[#F7F8FC] px-3 py-3">
              <p className="text-[12px] font-semibold text-[#334155]">Production is locked for your role on this project.</p>
              {canGrantProductionUnlock && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={unlockTargetUid}
                    onChange={(e) => setUnlockTargetUid(e.target.value)}
                    className="h-8 min-w-[200px] rounded-[8px] border border-[#D8DEE8] bg-white px-3 text-[12px] font-bold text-[#334155]"
                  >
                    {unlockMembers.length === 0 && <option value="">No other staff found</option>}
                    {unlockMembers.map((member) => (
                      <option key={member.uid} value={member.uid}>
                        {member.displayName} ({member.role})
                      </option>
                    ))}
                  </select>
                  <select
                    value={String(unlockHours)}
                    onChange={(e) => setUnlockHours(Number(e.target.value))}
                    className="h-8 rounded-[8px] border border-[#D8DEE8] bg-white px-3 text-[12px] font-bold text-[#334155]"
                  >
                    <option value="1">1 hour</option>
                    <option value="6">6 hours</option>
                    <option value="12">12 hours</option>
                    <option value="24">24 hours</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void onGrantProductionUnlock()}
                    disabled={isGrantingUnlock || !unlockTargetUid}
                    className="h-8 rounded-[8px] border border-[#D8DEE8] bg-[#EAF0F8] px-3 text-[12px] font-bold text-[#2F5E8A] disabled:opacity-60"
                  >
                    {isGrantingUnlock ? "Unlocking..." : "Unlock Production"}
                  </button>
                </div>
              )}
            </div>
          )}

          {resolvedTab === "general" && (
            <div className="-mx-4 -mb-4 -mt-4 md:-mx-5 xl:mx-0 xl:mb-0 xl:mt-0">
              <div className="space-y-4 px-3 sm:px-4 md:px-5 xl:px-0 xl:pt-0 xl:pb-0">
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-4">
                    <div ref={clientDetailsContainerRef}>
                      <Card className="shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                        <CardHeader className="flex min-h-[50px] flex-row items-center justify-between border-b border-[#D7DEE8] px-4 py-2">
                          <CardTitle className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Client Details</CardTitle>
                          <button
                            type="button"
                            disabled={!generalAccess.edit || isSavingGeneralDetails}
                            onClick={() => {
                              if (isEditingClientDetails) {
                                void commitClientDetails();
                              }
                              setIsEditingClientDetails((prev) => !prev);
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border hover:brightness-95 disabled:opacity-60"
                            style={
                              isEditingClientDetails
                                ? { backgroundColor: "#16A34A", borderColor: "#166534" }
                                : { backgroundColor: "#7E9EBB", borderColor: "#2F4E68" }
                            }
                            title={isEditingClientDetails ? "Save changes" : "Edit client details"}
                          >
                            <img
                              src={isEditingClientDetails ? "/tick.png" : "/Edit.png"}
                              alt={isEditingClientDetails ? "Save" : "Edit"}
                              className="block object-contain"
                              style={{ width: 16, height: 16, filter: "brightness(0) invert(1)" }}
                              onError={(e) => {
                                e.currentTarget.src = "/file.svg";
                              }}
                            />
                          </button>
                        </CardHeader>
                        <CardContent className="pt-1 text-[13px] text-[#1F2937]">
                          {[
                            { label: "Name", key: "customer" as const, value: project.customer || "-" },
                            { label: "Phone", key: "clientPhone" as const, value: project.clientPhone || "-" },
                            { label: "Email", key: "clientEmail" as const, value: project.clientEmail || "-" },
                            { label: "Address", key: "clientAddress" as const, value: project.clientAddress || "-" },
                          ].map((row) => (
                            <div key={row.label} className="grid grid-cols-[55px_1fr] border-b border-[#DCE3EC] py-[9px] last:border-none">
                              <p className="font-bold text-[#1E2D42]">{row.label}</p>
                              <div className="relative min-h-[20px]">
                                <p className={`text-[#2F3F56] ${isEditingClientDetails && generalAccess.edit ? "opacity-0" : ""}`}>
                                  {row.value}
                                </p>
                                {isEditingClientDetails && generalAccess.edit ? (
                                  <input
                                    type="text"
                                    value={generalDetailsDraft[row.key]}
                                    onChange={(e) => {
                                      const nextValue = e.target.value;
                                      setGeneralDetailsDraft((prev) => ({ ...prev, [row.key]: nextValue }));
                                    }}
                                    onBlur={() => void commitClientDetails()}
                                    className="absolute inset-0 h-full rounded-[6px] border border-[#C9D5E5] bg-white px-2 text-[12px] text-[#2F3F56]"
                                  />
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    </div>

                    <div ref={notesContainerRef}>
                      <Card className="shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                        <CardHeader className="flex min-h-[50px] flex-row items-center justify-between border-b border-[#D7DEE8] px-4 py-2">
                          <CardTitle className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Notes</CardTitle>
                          <div className="flex items-center gap-2">
                            {isEditingNotes && generalAccess.edit ? (
                              <div className="flex items-center gap-1 rounded-[8px] border border-[#C9D5E5] bg-white px-1 py-1">
                                <button
                                  type="button"
                                  className="inline-flex h-6 min-w-[26px] items-center justify-center rounded-[6px] border px-1 text-[12px] font-semibold hover:brightness-95"
                                  style={
                                    notesBoldActive
                                      ? { backgroundColor: "#2F6BFF", borderColor: "#1D4ED8", color: "#000000" }
                                      : { backgroundColor: "#FFFFFF", borderColor: "#D8DEE8", color: "#000000" }
                                  }
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    applyNotesFormat("bold");
                                    window.setTimeout(() => refreshNotesToolbarState(), 0);
                                  }}
                                  title="Bold"
                                >
                                  B
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-6 min-w-[26px] items-center justify-center rounded-[6px] border px-1 text-[12px] italic hover:brightness-95"
                                  style={
                                    notesItalicActive
                                      ? { backgroundColor: "#2F6BFF", borderColor: "#1D4ED8", color: "#000000" }
                                      : { backgroundColor: "#FFFFFF", borderColor: "#D8DEE8", color: "#000000" }
                                  }
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    applyNotesFormat("italic");
                                    window.setTimeout(() => refreshNotesToolbarState(), 0);
                                  }}
                                  title="Italic"
                                >
                                  I
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-6 min-w-[26px] items-center justify-center rounded-[6px] border px-1 text-[12px] line-through hover:brightness-95"
                                  style={
                                    notesStrikeActive
                                      ? { backgroundColor: "#2F6BFF", borderColor: "#1D4ED8", color: "#000000" }
                                      : { backgroundColor: "#FFFFFF", borderColor: "#D8DEE8", color: "#000000" }
                                  }
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    applyNotesFormat("strikeThrough");
                                    window.setTimeout(() => refreshNotesToolbarState(), 0);
                                  }}
                                  title="Strikethrough"
                                >
                                  S
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-6 min-w-[26px] items-center justify-center rounded-[6px] border px-1 text-[14px] font-semibold hover:brightness-95"
                                  style={
                                    notesBulletMode
                                      ? { backgroundColor: "#2F6BFF", borderColor: "#1D4ED8", color: "#FFFFFF" }
                                      : { backgroundColor: "#FFFFFF", borderColor: "#D8DEE8", color: "#243B58" }
                                  }
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    if (notesBulletMode) {
                                      setNotesBulletMode(false);
                                    } else {
                                      insertNotesBullet();
                                      setNotesBulletMode(true);
                                    }
                                    window.setTimeout(() => refreshNotesToolbarState(), 0);
                                  }}
                                  title="Bullets"
                                >
                                  <img
                                    src="/bulletpoint.png"
                                    alt="Bullets"
                                    className="block object-contain"
                                    style={{
                                      width: 14,
                                      height: 14,
                                      filter: "brightness(0) saturate(100%)",
                                    }}
                                    onError={(e) => {
                                      e.currentTarget.src = "/file.svg";
                                    }}
                                  />
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] border px-1 hover:brightness-95"
                                  style={{ backgroundColor: "#FFFFFF", borderColor: "#D8DEE8" }}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    toggleNotesParagraphMode();
                                    window.setTimeout(() => refreshNotesToolbarState(), 0);
                                  }}
                                  title="Paragraph"
                                >
                                  <img
                                    src="/paragraph.png"
                                    alt="Paragraph mode"
                                    className="block object-contain"
                                    style={{
                                      width: 14,
                                      height: 14,
                                      filter: notesParagraphMode ? "brightness(0) invert(1)" : "none",
                                    }}
                                    onError={(e) => {
                                      e.currentTarget.src = "/file.svg";
                                    }}
                                  />
                                </button>
                              </div>
                            ) : null}
                            <button
                              type="button"
                              disabled={!generalAccess.edit || isSavingGeneralDetails}
                              onClick={() => {
                                if (isEditingNotes) {
                                  void commitNotesDetails();
                                }
                                setIsEditingNotes((prev) => !prev);
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border hover:brightness-95 disabled:opacity-60"
                              style={
                                isEditingNotes
                                  ? { backgroundColor: "#16A34A", borderColor: "#166534" }
                                  : { backgroundColor: "#7E9EBB", borderColor: "#2F4E68" }
                              }
                              title={isEditingNotes ? "Save changes" : "Edit notes"}
                            >
                              <img
                                src={isEditingNotes ? "/tick.png" : "/Edit.png"}
                                alt={isEditingNotes ? "Save" : "Edit"}
                                className="block object-contain"
                                style={{ width: 16, height: 16, filter: "brightness(0) invert(1)" }}
                                onError={(e) => {
                                  e.currentTarget.src = "/file.svg";
                                }}
                              />
                            </button>
                          </div>
                        </CardHeader>
                        <CardContent className="min-h-[155px] pt-3 text-[13px] text-[#475467]">
                          <div className="relative min-h-[130px]">
                            <div
                              className={`notes-rich leading-[20px] ${isEditingNotes && generalAccess.edit ? "opacity-0" : ""}`}
                              dangerouslySetInnerHTML={{ __html: notesToDisplayHtml(project.notes || "") }}
                            />
                            {isEditingNotes && generalAccess.edit ? (
                              <div
                                ref={notesEditorRef}
                                contentEditable
                                suppressContentEditableWarning
                                onKeyDown={(e) => {
                                  if (e.key !== "Enter") {
                                    notesLastEnterAtRef.current = 0;
                                    if (notesParagraphMode) {
                                      applyParagraphClassToCurrentLine();
                                    }
                                    window.setTimeout(() => refreshNotesToolbarState(), 0);
                                    return;
                                  }
                                  if (notesBulletMode) {
                                    if (isCurrentBulletLineEmpty()) {
                                      e.preventDefault();
                                      setNotesBulletMode(false);
                                      notesLastEnterAtRef.current = 0;
                                      removeBulletPrefixFromCurrentLine();
                                      window.setTimeout(() => refreshNotesToolbarState(), 0);
                                      return;
                                    }
                                    e.preventDefault();
                                    insertNextBulletLine();
                                    notesLastEnterAtRef.current = Date.now();
                                    const editor = notesEditorRef.current;
                                    if (editor) {
                                      setGeneralDetailsDraft((prev) => ({ ...prev, notes: editor.innerHTML }));
                                    }
                                    window.setTimeout(() => refreshNotesToolbarState(), 0);
                                    return;
                                  }
                                  if (!notesParagraphMode) {
                                    notesLastEnterAtRef.current = Date.now();
                                    return;
                                  }
                                  if (isCurrentParagraphLineEmpty()) {
                                    e.preventDefault();
                                    setNotesParagraphMode(false);
                                    notesLastEnterAtRef.current = 0;
                                    exitParagraphModeOnCurrentLine();
                                    window.setTimeout(() => refreshNotesToolbarState(), 0);
                                    return;
                                  }
                                  const now = Date.now();
                                  if (now - notesLastEnterAtRef.current <= 800) {
                                    e.preventDefault();
                                    setNotesParagraphMode(false);
                                    notesLastEnterAtRef.current = 0;
                                    exitParagraphModeOnCurrentLine();
                                    window.setTimeout(() => refreshNotesToolbarState(), 0);
                                    return;
                                  }
                                  e.preventDefault();
                                  try {
                                    document.execCommand("insertHTML", false, "<div class=\"notes-paragraph-line\"><br></div>");
                                  } catch {
                                    // no-op
                                  }
                                  notesLastEnterAtRef.current = now;
                                }}
                                onInput={(e) => {
                                  if (notesParagraphMode) {
                                    applyParagraphClassToCurrentLine();
                                  }
                                  const nextValue = (e.currentTarget as HTMLDivElement).innerHTML;
                                  setGeneralDetailsDraft((prev) => ({ ...prev, notes: nextValue }));
                                  window.setTimeout(() => refreshNotesToolbarState(), 0);
                                }}
                                className="notes-rich absolute inset-0 h-full w-full overflow-auto rounded-[8px] border border-[#C9D5E5] bg-white px-2 py-2 text-[12px] text-[#2F3F56] focus:outline-none"
                              />
                            ) : null}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <Card className="shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                  <div className="flex min-h-[50px] flex-wrap items-center justify-between gap-2 border-b border-[#D7DEE8] px-4 py-2">
                    <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Images</p>
                    <div className="ml-auto flex items-center gap-2">
                      <input
                        ref={projectImagesInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        style={{ display: "none" }}
                        tabIndex={-1}
                        aria-hidden="true"
                        onChange={(e) => {
                          void onUploadProjectImages(e.target.files);
                          e.currentTarget.value = "";
                        }}
                      />
                      {isUploadingProjectImages && (
                        <div className="mr-1 hidden items-center gap-2 sm:flex">
                          <div className="h-[8px] w-[160px] overflow-hidden rounded-full border border-[#C9D5E5] bg-white">
                            <div
                              className="h-full rounded-full bg-[#2F6BFF] transition-[width] duration-150"
                              style={{ width: `${projectImageUploadProgress}%` }}
                            />
                          </div>
                          <span className="w-[40px] text-right text-[11px] font-bold text-[#12345B]">
                            {projectImageUploadProgress}%
                          </span>
                        </div>
                      )}
                      {projectImageUrls.length < 5 && (
                        <button
                          type="button"
                          disabled={!generalAccess.edit || isUploadingProjectImages || isDeletingProjectImage}
                          onClick={() => projectImagesInputRef.current?.click()}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border bg-[#7E9EBB] hover:brightness-95 disabled:opacity-60"
                          style={{ borderColor: "#2F4E68" }}
                          title={isUploadingProjectImages ? "Uploading..." : "Add image"}
                        >
                          <img
                            src="/add-image.png"
                            alt="Add image"
                            className="block object-contain"
                            style={{
                              width: 17,
                              height: 17,
                              filter: "brightness(0) invert(1)",
                              transform: "translate(1px, 1px)",
                            }}
                            onError={(e) => {
                              e.currentTarget.src = "/file.svg";
                            }}
                          />
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!generalAccess.edit || isUploadingProjectImages || isDeletingProjectImage}
                        onClick={() => void onDeleteSelectedProjectImage()}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
                        style={{
                          backgroundColor: "#EF4444",
                          borderColor: "#7F1D1D",
                        }}
                        title={isDeletingProjectImage ? "Deleting..." : "Delete image"}
                      >
                        <img
                          src="/trash.png"
                          alt="Delete"
                          className="block object-contain"
                          style={{
                            width: 17,
                            height: 17,
                            filter: "brightness(0) invert(1)",
                            transform: "translateX(0px)",
                          }}
                          onError={(e) => {
                            e.currentTarget.src = "/file.svg";
                          }}
                        />
                      </button>
                    </div>
                  </div>
                  <CardContent className="pt-4 pb-3" style={{ minHeight: Math.max(400, projectImageAreaHeight + 28) }}>
                    {projectImageUrls.length > 0 ? (
                      <div className="flex items-start gap-3">
                        <div className="w-[88px] flex-none">
                          <div ref={projectImageThumbsRef} className="flex flex-col gap-[6px] pr-1">
                          {projectImageUrls.map((url, idx) => {
                            const selected = idx === selectedProjectImageIndex;
                            return (
                              <button
                                key={`${url}_${idx}`}
                                type="button"
                                onClick={() => setSelectedProjectImageIndex(idx)}
                                className={`box-border flex w-full items-center justify-center overflow-hidden rounded-[8px] border bg-[#F8FAFC] transition ${
                                  selected ? "border-[#2F6BFF]" : "border-[#D8DEE8] hover:border-[#94A3B8]"
                                }`}
                                title={`Image ${idx + 1}`}
                              >
                                <img
                                  src={url}
                                  alt={`Project image ${idx + 1}`}
                                  className="block h-full w-full object-cover"
                                  onLoad={() => {
                                    const el = projectImageThumbsRef.current;
                                    if (!el) return;
                                    const h = Math.ceil(el.scrollHeight || el.getBoundingClientRect().height);
                                    if (h > 0) setProjectImageMeasuredHeight(h);
                                  }}
                                />
                              </button>
                            );
                          })}
                          </div>
                        </div>
                        <div
                          className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden"
                          style={{ height: projectImageAreaHeight, maxHeight: projectImageAreaHeight }}
                        >
                          <button
                            type="button"
                            onClick={showPrevProjectImage}
                            disabled={projectImageUrls.length <= 1}
                            className="project-image-nav-arrow absolute left-2 top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[10px] border border-[#000000] p-0 shadow-[0_2px_6px_rgba(0,0,0,0.2)] backdrop-blur-[1px] transition duration-150 hover:translate-y-[-45%] hover:shadow-[0_1px_3px_rgba(0,0,0,0.16)] active:translate-y-[-40%] active:shadow-[0_0px_2px_rgba(0,0,0,0.14)] disabled:opacity-40"
                            style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
                            title="Previous image"
                          >
                            <img
                              src="/angle-left.png"
                              alt="Previous"
                              className="h-5 w-5 object-contain brightness-0"
                              onError={(e) => {
                                e.currentTarget.src = "/arrow-right.png";
                                e.currentTarget.classList.add("-scale-x-100");
                              }}
                            />
                          </button>
                          <div
                            ref={projectImageViewportRef}
                            className="flex h-full w-full items-center justify-center overflow-hidden"
                            title="Alt + scroll to zoom, drag to pan"
                            onWheelCapture={onProjectImageWheel}
                            onWheel={onProjectImageWheel}
                            onPointerDown={onProjectImagePointerDown}
                            onPointerMove={onProjectImagePointerMove}
                            onPointerUp={onProjectImagePointerEnd}
                            onPointerCancel={onProjectImagePointerEnd}
                            style={{
                              cursor: projectImageZoom > 1 ? (projectImageDragging ? "grabbing" : "grab") : "default",
                            }}
                          >
                            <img
                              ref={projectImagePreviewRef}
                              src={projectImageUrls[selectedProjectImageIndex] || projectImageUrls[0]}
                              alt="Selected project image"
                              className="block h-full w-auto object-contain"
                              style={{
                                maxHeight: projectImageAreaHeight,
                                transform: `translate(${projectImagePan.x}px, ${projectImagePan.y}px) scale(${projectImageZoom})`,
                                transformOrigin: "center center",
                              }}
                              draggable={false}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={showNextProjectImage}
                            disabled={projectImageUrls.length <= 1}
                            className="project-image-nav-arrow absolute right-2 top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[10px] border border-[#000000] p-0 shadow-[0_2px_6px_rgba(0,0,0,0.2)] backdrop-blur-[1px] transition duration-150 hover:translate-y-[-45%] hover:shadow-[0_1px_3px_rgba(0,0,0,0.16)] active:translate-y-[-40%] active:shadow-[0_0px_2px_rgba(0,0,0,0.14)] disabled:opacity-40"
                            style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
                            title="Next image"
                          >
                            <img
                              src="/angle-right.png"
                              alt="Next"
                              className="h-5 w-5 object-contain brightness-0"
                              onError={(e) => {
                                e.currentTarget.src = "/arrow-right.png";
                              }}
                            />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-h-[240px] items-center justify-center text-[13px] text-[#98A2B3]">
                        No images uploaded.
                      </div>
                    )}
                  </CardContent>
                </Card>
<Card className="shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                  <div className="flex min-h-[50px] flex-wrap items-center justify-between gap-2 border-b border-[#D7DEE8] px-4 py-2">
                    <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Files</p>
                    <div className="ml-auto flex items-center gap-2">
                      <p className="mr-1 text-[12px] font-bold text-[#475467]">{formatProjectFileTotal(projectFilesTotalBytes)}</p>
                      <input
                        ref={projectFilesInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.dwg,.dxf,.zip,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,application/rtf,application/zip,application/x-zip-compressed"
                        multiple
                        className="hidden"
                        style={{ display: "none" }}
                        tabIndex={-1}
                        aria-hidden="true"
                        onChange={(e) => {
                          void onUploadProjectFiles(e.target.files);
                          e.currentTarget.value = "";
                        }}
                      />
                      {isUploadingProjectFiles && (
                        <div className="mr-1 hidden items-center gap-2 sm:flex">
                          <div className="h-[8px] w-[120px] overflow-hidden rounded-full border border-[#C9D5E5] bg-white">
                            <div
                              className="h-full rounded-full bg-[#2F6BFF] transition-[width] duration-150"
                              style={{ width: `${projectFileUploadProgress}%` }}
                            />
                          </div>
                          <span className="w-[40px] text-right text-[11px] font-bold text-[#12345B]">{projectFileUploadProgress}%</span>
                        </div>
                      )}
                      {projectFilesTotalBytes < PROJECT_FILE_TOTAL_LIMIT_BYTES && (
                        <button
                          type="button"
                          disabled={!generalAccess.edit || isUploadingProjectFiles || isDeletingProjectFile}
                          onClick={() => projectFilesInputRef.current?.click()}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border bg-[#7E9EBB] hover:brightness-95"
                          style={{ borderColor: "#2F4E68" }}
                          title="Add file"
                        >
                          <img
                            src="/add-file.png"
                            alt="Add file"
                            className="block object-contain"
                            style={{ width: 17, height: 17, filter: "brightness(0) invert(1)" }}
                            onError={(e) => {
                              e.currentTarget.src = "/file.svg";
                            }}
                          />
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!generalAccess.edit || isUploadingProjectFiles || isDeletingProjectFile}
                        onClick={() => void onDeleteSelectedProjectFile()}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border hover:brightness-95"
                        style={{ backgroundColor: "#EF4444", borderColor: "#7F1D1D" }}
                        title="Delete file"
                      >
                        <img
                          src="/trash.png"
                          alt="Delete file"
                          className="block object-contain"
                          style={{ width: 17, height: 17, filter: "brightness(0) invert(1)" }}
                          onError={(e) => {
                            e.currentTarget.src = "/file.svg";
                          }}
                        />
                      </button>
                    </div>
                  </div>
                  <CardContent className="min-h-[280px] px-0 pb-0 pt-0">
                    {projectFiles.length > 0 ? (
                      <div className="border-b border-[#D8DEE8]">
                        {projectFiles.map((file, idx) => {
                          const selected = idx === selectedProjectFileIndex;
                          const checked = selectedProjectFileIds.includes(file.id);
                          const link = file.url || file.path;
                          return (
                            <div
                              key={`${file.id}_${idx}`}
                              className={`flex w-full items-center justify-between px-[10px] py-2 text-[12px] ${
                                idx < projectFiles.length - 1 ? "border-b border-[#D8DEE8]" : ""
                              } ${selected ? "bg-[#EEF3FF]" : "bg-transparent"}`}
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const nextChecked = e.target.checked;
                                    setSelectedProjectFileIds((prev) => {
                                      if (nextChecked) {
                                        return prev.includes(file.id) ? prev : [...prev, file.id];
                                      }
                                      return prev.filter((id) => id !== file.id);
                                    });
                                  }}
                                  className="h-4 w-4 rounded border-[#C9D5E5]"
                                  aria-label={`Select ${file.name}`}
                                />
                                <button
                                  type="button"
                                  onClick={() => setSelectedProjectFileIndex(idx)}
                                  className="min-w-0 flex-1 truncate text-left font-semibold text-[#1F2937]"
                                  title={file.name}
                                >
                                  {file.name}
                                </button>
                              </div>
                              <div className="ml-3 flex items-center gap-3">
                                <p className="text-[11px] font-semibold text-[#64748B]">{formatBytes(file.size)}</p>
                                {link ? (
                                  <button
                                    type="button"
                                    onClick={() => setOpenProjectFilePreviewId(file.id)}
                                    className="inline-flex h-6 items-center justify-center rounded-[6px] border border-[#1D4ED8] bg-[#2563EB] px-2 text-[11px] font-bold text-white hover:bg-[#1D4ED8]"
                                  >
                                    Open
                                  </button>
                                ) : null}
                                {link ? (
                                  <a
                                    href={link}
                                    download={file.name || true}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] border border-[#166534] bg-[#16A34A] hover:bg-[#15803D]"
                                    title="Download file"
                                    aria-label={`Download ${file.name}`}
                                  >
                                    <img
                                      src="/download.png"
                                      alt="Download"
                                      className="h-4 w-4 object-contain"
                                      style={{ filter: "brightness(0) invert(1)" }}
                                      onError={(e) => {
                                        e.currentTarget.src = "/file.svg";
                                      }}
                                    />
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex min-h-[240px] items-center justify-center text-[13px] text-[#98A2B3]">
                        No files uploaded.
                      </div>
                    )}
                  </CardContent>
                </Card>
                </div>
              </div>
              </div>
            </div>
          )}

          {resolvedTab === "sales" && salesAccess.view && (
            <div className="-mx-4 -mb-4 -mt-4 min-h-[100dvh] items-stretch gap-4 md:-mx-5 xl:grid xl:grid-cols-[170px_1fr]">
              <aside className="h-full overflow-hidden border-b border-[#DCE3EC] px-1 pb-2 sm:overflow-x-auto xl:overflow-hidden xl:border-b-0 xl:border-r xl:px-0 xl:pb-0">
                <div className="flex flex-col items-stretch sm:min-w-max sm:flex-row xl:block xl:min-w-0">
                {[
                  { label: "Initial Measure", icon: Ruler, key: "initial" as const },
                  { label: "Items", icon: ListChecks, key: "items" as const },
                  { label: "Quote", icon: Quote, key: "quote" as const },
                  { label: "Specifications", icon: ClipboardList, key: "specifications" as const },
                ].map((item, idx, arr) => {
                  const Icon = item.icon;
                  const active = salesNav === item.key;
                  return (
                    <div key={item.label} className="w-full sm:w-auto xl:w-full">
                    <button
                      type="button"
                      disabled={salesReadOnly}
                      onClick={() => setSalesNav(item.key)}
                      className={`inline-flex w-full min-w-0 items-center gap-2 whitespace-nowrap pl-0 pr-2 py-3 text-left text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto sm:min-w-[120px] xl:w-full xl:min-w-0 xl:whitespace-normal ${
                        active ? "bg-[#EEF2F7] text-[#12345B]" : "text-[#243B58] hover:bg-[#EEF2F7]"
                      }`}
                    >
                      <span className="pl-4">
                        <Icon size={13} />
                      </span>
                      {item.label}
                    </button>
                    {idx < arr.length - 1 && (
                      <div className="my-0.5 h-px w-full bg-[#DCE3EC] sm:mx-1 sm:my-0 sm:h-auto sm:w-px xl:-ml-px xl:-mr-px xl:h-px xl:w-auto" />
                    )}
                    </div>
                  );
                })}
                </div>
              </aside>

              <div
                className={
                  salesNav === "initial"
                    ? "isolate mt-0 w-full min-h-[calc(100dvh-235px)] px-3 sm:px-4 md:px-5 xl:px-0"
                    : "isolate mt-2 w-full max-w-[1120px] space-y-4 px-3 sm:px-4 md:px-5 xl:mt-4 xl:px-0"
                }
              >
                {salesReadOnly && (
                  <div className="rounded-[10px] border border-[#D6DEE9] bg-[#EEF2F7] px-3 py-2 text-[12px] font-semibold text-[#334155]">
                    Sales is in read-only mode for your account.
                  </div>
                )}
                {salesNav === "initial" ? (
                  <div className="grid h-full min-h-[calc(100dvh-235px)] gap-0 xl:grid-cols-[190px_1fr]">
                    <aside className="border-r border-[#DCE3EC]">
                      <div className="flex h-full flex-col p-2">
                        <p className="mb-2 px-2 text-[16px] font-medium text-[#111827]">Rooms</p>
                        <div className="flex flex-1 flex-col">
                        <div className="space-y-1">
                          {initialCutlistAddedRoomTabs.map((roomTab) => {
                            const active = initialCutlistRoomFilter === roomTab.filter;
                            return (
                              <button
                                key={`${roomTab.label}_${roomTab.filter}`}
                                type="button"
                                onClick={() => setInitialCutlistRoomFilter(roomTab.filter)}
                                className={`w-full rounded-[9px] px-2 py-2 text-left text-[12px] font-semibold ${
                                  active ? "bg-[#E9EFF7] text-[#12345B]" : "text-[#334155] hover:bg-[#F1F5F9]"
                                }`}
                              >
                                {roomTab.label}
                              </button>
                            );
                          })}
                          <div className="my-2 h-px bg-[#DCE3EC]" />
                          {initialCutlistRoomTabs
                            .filter((tab) => tab.filter === "Project Cutlist")
                            .map((roomTab) => {
                              const active = initialCutlistRoomFilter === roomTab.filter;
                              return (
                                <button
                                  key={`${roomTab.label}_${roomTab.filter}`}
                                  type="button"
                                  onClick={() => setInitialCutlistRoomFilter(roomTab.filter)}
                                  className={`w-full rounded-[9px] px-2 py-2 text-left text-[12px] font-semibold ${
                                    active ? "bg-[#E9EFF7] text-[#12345B]" : "text-[#334155] hover:bg-[#F1F5F9]"
                                  }`}
                                >
                                  {roomTab.label}
                                </button>
                              );
                            })}
                          <button
                            type="button"
                            disabled={!salesAccess.edit || isSavingSalesRooms}
                            onClick={() => void onAddCutlistRoom()}
                            className="mt-2 w-full rounded-[9px] border border-[#BFE8CF] bg-[#DDF2E7] px-2 py-2 text-left text-[12px] font-bold text-[#1F6A3B] disabled:opacity-55"
                          >
                            + Add Room
                          </button>
                        </div>
                          {initialMeasureLargerSheetWarningsByRoom.length > 0 && (
                            <div className="mt-auto pt-3">
                            <div className="rounded-[10px] border border-[#F2D06B] bg-[#FFF4BF] px-2 py-2 text-[#7A5600]">
                              <div className="flex items-center gap-1">
                                <img
                                  src="/danger.png"
                                  alt="Warning"
                                  className="h-[13px] w-[13px] object-contain"
                                  style={{ filter: "brightness(0) saturate(100%) invert(31%) sepia(27%) saturate(1683%) hue-rotate(14deg) brightness(93%) contrast(101%)" }}
                                />
                                <p className="text-[12px] font-semibold">Large sheets used</p>
                              </div>
                              <div className="mt-2 border-t border-[rgba(122,86,0,0.18)] pt-2 space-y-2">
                                {initialMeasureLargerSheetWarningsByRoom.map((roomBlock) => (
                                  <div key={`im_warn_tab_${roomBlock.room}`} className="border-b border-[rgba(122,86,0,0.18)] pb-2 last:border-b-0 last:pb-0">
                                    <p className="text-[10px] font-bold">{roomBlock.room}:</p>
                                    <div className="mt-1 space-y-1">
                                      {roomBlock.entries.map((entry, idx) => (
                                        <p key={`im_warn_tab_${roomBlock.room}_${entry.productName}_${entry.sheetSize}_${idx}`} className="text-[10px] font-medium text-[#8A6A16]">
                                          {entry.productName} {" | "} {entry.sheetSize} {" | "} {entry.sheetCount > 0 ? `${entry.sheetCount}` : ""} {entry.sheetCount === 1 ? "Sheet" : "Sheets"}
                                        </p>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-2 flex items-center justify-between border-t border-[rgba(122,86,0,0.18)] pt-2">
                                <span className="text-[10px] font-semibold">Added to quote</span>
                                <img
                                  src={salesRoomSheetAnalysis.largerSheetPricingAddedToQuote ? "/tick.png" : "/cross-small.png"}
                                  alt={salesRoomSheetAnalysis.largerSheetPricingAddedToQuote ? "Added to quote" : "Not added to quote"}
                                  className="h-4 w-4 object-contain"
                                  style={{ filter: salesRoomSheetAnalysis.largerSheetPricingAddedToQuote ? "none" : "brightness(0) saturate(100%) invert(18%) sepia(89%) saturate(2660%) hue-rotate(348deg) brightness(92%) contrast(89%)" }}
                                />
                              </div>
                            </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </aside>

                    <div className="flex min-h-full flex-col gap-4 pl-4">
                      {initialCutlistRoomFilter !== "Project Cutlist" && (
                        <section className="relative z-10 w-full flex-1 overflow-hidden xl:-mx-4 xl:w-[calc(100%+2rem)]">
                          <div className="flex h-[50px] items-center px-1">
                            <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Cutlist Entry</p>
                          </div>
                          <div className="space-y-3 px-0 pb-0">
                            <div className="flex flex-wrap items-center gap-2 rounded-[8px] px-1">
                              {initialMeasurePartTypeOptions.map((v) => {
                                const color = partTypeColors[v] ?? "#CBD5E1";
                                return (
                                  <button
                                    key={`im_pt_${v}`}
                                    type="button"
                                    disabled={salesReadOnly}
                                    onClick={() => setInitialCutlistEntry((prev) => ({ ...prev, partType: v }))}
                                    style={{
                                      backgroundColor: color,
                                      borderColor: color,
                                      color: isLightHex(color) ? "#1F2937" : "#F8FAFC",
                                    }}
                                    className="rounded-[8px] border px-2 py-1 text-[11px] font-medium disabled:opacity-55"
                                  >
                                    {v}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="grid gap-2 text-[11px] font-bold text-[#8A97A8]" style={{ gridTemplateColumns: initialCutlistEntryGridTemplate }}>
                              <p></p>
                              {initialCutlistEntryColumnDefs.map((col) => (
                                <p
                                  key={`im_entry_header_${col.key}`}
                                  className={isCenteredCutlistColumn(col.key) ? "text-center" : ""}
                                  style={col.key === "clashing" ? initialCutlistEntryCellStyle("clashing", 2) : initialCutlistEntryCellStyle(col.key)}
                                >
                                  {col.label}
                                </p>
                              ))}
                            </div>
                            <div className="grid gap-2 border-y px-1 py-1" style={{ gridTemplateColumns: initialCutlistEntryGridTemplate, backgroundColor: activeInitialCutlistEntryColor, color: activeInitialCutlistEntryTextColor, borderColor: activeInitialCutlistEntryFieldBorder }}>
                              <p></p>
                              <div style={initialCutlistEntryCellStyle("board")}>
                                <BoardPillDropdown
                                  value={initialCutlistEntry.board}
                                  options={initialMeasureBoardOptions}
                                  disabled={salesReadOnly}
                                  bg={activeInitialCutlistEntryFieldBg}
                                  border={activeInitialCutlistEntryFieldBorder}
                                  text={activeInitialCutlistEntryTextColor}
                                  getSize={boardSizeFor}
                                  getLabel={boardDisplayLabel}
                                  onChange={onInitialCutlistEntryBoardChange}
                                />
                              </div>
                              <input disabled={salesReadOnly} value={initialCutlistEntry.name} onChange={(e) => setInitialCutlistEntry((prev) => ({ ...prev, name: e.target.value }))} className="h-8 rounded-[8px] border bg-transparent px-2 text-[12px]" style={{ backgroundColor: activeInitialCutlistEntryFieldBg, borderColor: activeInitialCutlistEntryFieldBorder, color: activeInitialCutlistEntryTextColor, ...initialCutlistEntryCellStyle("name") }} />
                              <input disabled={salesReadOnly} inputMode="numeric" pattern="[0-9]*" value={initialCutlistEntry.height} onChange={(e) => setInitialCutlistEntry((prev) => ({ ...prev, height: numericOnlyText(e.target.value) }))} className="h-8 rounded-[8px] border bg-transparent px-2 text-center text-[12px]" style={{ backgroundColor: activeInitialCutlistEntryFieldBg, borderColor: activeInitialCutlistEntryFieldBorder, color: activeInitialCutlistEntryTextColor, ...initialCutlistEntryCellStyle("height") }} />
                              <input disabled={salesReadOnly} inputMode="numeric" pattern="[0-9]*" value={initialCutlistEntry.width} onChange={(e) => setInitialCutlistEntry((prev) => ({ ...prev, width: numericOnlyText(e.target.value) }))} className="h-8 rounded-[8px] border bg-transparent px-2 text-center text-[12px]" style={{ backgroundColor: activeInitialCutlistEntryFieldBg, borderColor: activeInitialCutlistEntryFieldBorder, color: activeInitialCutlistEntryTextColor, ...initialCutlistEntryCellStyle("width") }} />
                              <input disabled={salesReadOnly} inputMode="numeric" pattern="[0-9]*" value={initialCutlistEntry.depth} onChange={(e) => setInitialCutlistEntry((prev) => ({ ...prev, depth: numericOnlyText(e.target.value) }))} className="h-8 rounded-[8px] border bg-transparent px-2 text-center text-[12px]" style={{ backgroundColor: activeInitialCutlistEntryFieldBg, borderColor: activeInitialCutlistEntryFieldBorder, color: activeInitialCutlistEntryTextColor, ...initialCutlistEntryCellStyle("depth") }} />
                              <input disabled={salesReadOnly} inputMode="numeric" pattern="[0-9]*" value={initialCutlistEntry.quantity} onChange={(e) => setInitialCutlistEntry((prev) => ({ ...prev, quantity: numericOnlyText(e.target.value) }))} className="h-8 rounded-[8px] border bg-transparent px-2 text-center text-[12px]" style={{ backgroundColor: activeInitialCutlistEntryFieldBg, borderColor: activeInitialCutlistEntryFieldBorder, color: activeInitialCutlistEntryTextColor, ...initialCutlistEntryCellStyle("quantity") }} />
                              <div style={initialCutlistEntrySubCellStyle("clashing", 0)}>
                                <BoardPillDropdown value={initialCutlistEntry.clashLeft ?? ""} options={CLASH_LEFT_OPTIONS} disabled={salesReadOnly} bg={activeInitialCutlistEntryFieldBg} border={activeInitialCutlistEntryFieldBorder} text={activeInitialCutlistEntryTextColor} size="default" getSize={() => ""} getLabel={(v) => v} onChange={(v) => setInitialCutlistEntry((prev) => ({ ...prev, clashLeft: v }))} />
                              </div>
                              <div style={initialCutlistEntrySubCellStyle("clashing", 1)}>
                                <BoardPillDropdown value={initialCutlistEntry.clashRight ?? ""} options={CLASH_RIGHT_OPTIONS} disabled={salesReadOnly} bg={activeInitialCutlistEntryFieldBg} border={activeInitialCutlistEntryFieldBorder} text={activeInitialCutlistEntryTextColor} size="default" getSize={() => ""} getLabel={(v) => v} onChange={(v) => setInitialCutlistEntry((prev) => ({ ...prev, clashRight: v }))} />
                              </div>
                              <input disabled={salesReadOnly} value={initialCutlistEntry.information} onChange={(e) => setInitialCutlistEntry((prev) => ({ ...prev, information: e.target.value }))} className="h-8 rounded-[8px] border bg-transparent px-2 text-[12px]" placeholder="Information" style={{ backgroundColor: activeInitialCutlistEntryFieldBg, borderColor: activeInitialCutlistEntryFieldBorder, color: activeInitialCutlistEntryTextColor, ...initialCutlistEntryCellStyle("information") }} />
                              {showInitialCutlistGrainColumn && (
                                initialMeasureBoardGrainFor(String(initialCutlistEntry.board ?? "").trim()) ? (
                                  <div style={initialCutlistEntryCellStyle("grain")}>
                                    <BoardPillDropdown value={String(initialCutlistEntry.grainValue ?? "")} options={initialMeasureGrainDimensionOptionsForRow(initialCutlistEntry)} disabled={salesReadOnly} bg={activeInitialCutlistEntryFieldBg} border={activeInitialCutlistEntryFieldBorder} text={activeInitialCutlistEntryTextColor} size="default" getSize={() => ""} getLabel={(v) => v} onChange={(v) => setInitialCutlistEntry((prev) => ({ ...prev, grainValue: v, grain: Boolean(String(v || "").trim()) }))} />
                                  </div>
                                ) : (
                                  <div style={initialCutlistEntryCellStyle("grain")} />
                                )
                              )}
                            </div>
                            <button
                              type="button"
                              disabled={salesReadOnly}
                              onClick={() => void addInitialCutlistRow()}
                              className="w-full border border-[#BFDCCD] bg-[#CCE8D8] py-3 text-[40px] font-black leading-none text-[#0F5132] disabled:opacity-55"
                            >
                              Add to Cutlist
                            </button>
                          </div>
                        </section>
                      )}

                      <section className="w-full overflow-hidden xl:-mx-4 xl:w-[calc(100%+2rem)]">
                          <div className="flex items-center justify-between px-1 py-2">
                            <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Cutlist List</p>
                            <div className="flex items-center gap-2">
                              {initialPendingDeleteRowsSet.size > 0 && (
                                <button
                                  type="button"
                                  disabled={salesReadOnly}
                                  onClick={() => void deletePendingInitialCutlistRows()}
                                  className="inline-flex h-8 items-center justify-center rounded-[8px] border px-3 text-[12px] font-bold"
                                  style={{
                                    borderColor: initialDeleteAllArmed ? "#8AC0A0" : "#F2A7A7",
                                    backgroundColor: initialDeleteAllArmed ? "#DFF3E7" : "#FFECEC",
                                    color: initialDeleteAllArmed ? "#1E6A43" : "#991B1B",
                                  }}
                                  title={initialDeleteAllArmed ? "Confirm delete selected rows" : "Delete selected rows"}
                                >
                                  {initialDeleteAllArmed ? `Confirm (${initialPendingDeleteRowsSet.size})` : `Delete (${initialPendingDeleteRowsSet.size})`}
                                </button>
                              )}
                              <input value={initialCutlistSearch} onChange={(e) => setInitialCutlistSearch(e.target.value)} placeholder="Search part name or board" className="h-8 w-[240px] rounded-[8px] border border-[#D8DEE8] bg-[#F3F5F8] px-2 text-[12px] text-[#243B58]" />
                              <select value={initialCutlistPartTypeFilter} onChange={(e) => setInitialCutlistPartTypeFilter(e.target.value)} className="h-8 rounded-[8px] border border-[#D8DEE8] bg-[#F3F5F8] px-2 text-[12px] text-[#243B58]">
                                <option>All Part Types</option>
                                {initialMeasurePartTypeOptions.map((v) => (
                                  <option key={`im_filter_${v}`} value={v}>{v}</option>
                                ))}
                            </select>
                          </div>
                        </div>
                        <div className="rounded-[10px] border border-[#D8DEE8] bg-white">
                          <table className="w-full text-[12px]">
                            <thead>
                              <tr className="border-b border-[#D8DEE8] bg-[#EEF2F7]">
                                <th className="px-2 py-2"></th>
                                {showRoomColumnInInitialList && <th className="px-2 py-2 text-left">Room</th>}
                                {initialCutlistListColumnDefs.map((col) => (
                                  <th key={`im_list_h_${col.key}`} className={`px-2 py-2 ${cutlistHeaderAlignClass(col.key as CutlistEditableField)}`} style={cutlistListColumnStyle(col.key as CutlistEditableField)}>
                                    {col.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {visibleInitialCutlistRows.map((row, idx) => {
                                const rowColor = partTypeColors[row.partType] ?? "#E2E8F0";
                                const rowTextColor = isLightHex(rowColor) ? "#1F2937" : "#F8FAFC";
                                const rowPendingDelete = initialPendingDeleteRowsSet.has(row.id);
                                return (
                                  <tr key={`im_row_${row.id}_${idx}`} className="border-b border-[#DDE4EE] last:border-b-0" style={{ backgroundColor: lightenHex(rowColor, 0.2) }}>
                                    <td className="px-2 py-2">
                                      <button
                                        type="button"
                                        disabled={salesReadOnly}
                                        onClick={() => toggleInitialPendingCutlistRowDelete(row.partType, row.id)}
                                        className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] border disabled:opacity-55"
                                        style={{
                                          borderColor: rowPendingDelete ? "#8AC0A0" : "#F4B5B5",
                                          backgroundColor: rowPendingDelete ? "#DFF3E7" : "#FCEAEA",
                                          color: rowPendingDelete ? "#1E6A43" : "#C62828",
                                        }}
                                      >
                                        {rowPendingDelete ? (
                                          <img src="/tick.png" alt="Selected" className="h-[11px] w-[11px] object-contain" />
                                        ) : (
                                          <X size={11} strokeWidth={2.5} />
                                        )}
                                      </button>
                                    </td>
                                    {showRoomColumnInInitialList && <td className="px-2 py-2 text-left text-[#334155]">{row.room}</td>}
                                    {initialCutlistListColumnDefs.map((col) => {
                                      const key = col.key as CutlistEditableField;
                                      const value =
                                        key === "partType" ? row.partType :
                                        key === "board" ? row.board :
                                        key === "name" ? row.name :
                                        key === "height" ? row.height :
                                        key === "width" ? row.width :
                                        key === "depth" ? row.depth :
                                        key === "quantity" ? row.quantity :
                                        key === "clashing" ? joinClashing(String(row.clashLeft ?? ""), String(row.clashRight ?? "")) :
                                        key === "grain" ? String(row.grainValue ?? "") :
                                        row.information;
                                      return (
                                        <td key={`im_list_c_${row.id}_${key}`} className={`px-2 py-2 ${cutlistCellAlignClass(key)}`} style={{ ...cutlistListColumnStyle(key), color: key === "partType" ? rowTextColor : "#0F172A" }}>
                                          {String(value ?? "")}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                              {visibleInitialCutlistRows.length === 0 && (
                                <tr>
                                  <td colSpan={initialCutlistListColumnDefs.length + (showRoomColumnInInitialList ? 2 : 1)} className="px-3 py-6 text-center text-[12px] text-[#7A8798]">
                                    No cutlist rows yet.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    </div>
                  </div>
                ) : salesNav === "quote" ? (
                  salesQuoteFullscreenPortal
                ) : (
                  <>
                  <div className="grid gap-4 xl:grid-cols-[430px_1fr_1fr]">
                    <section className="rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                      <div className="flex h-[50px] items-center justify-between border-b border-[#D7DEE8] px-4">
                        <p className="text-[14px] font-medium tracking-[1px] text-[#0F2A4A]">ROOMS</p>
                        <button
                          type="button"
                          disabled={salesReadOnly || isSavingSalesRooms}
                          onClick={() => void onAddCutlistRoom()}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-[#A9DDBF] bg-[#EAF8F0] text-[16px] font-bold leading-none text-[#1F8A4C] hover:bg-[#DDF2E7] disabled:opacity-55"
                          title="Add room"
                        >
                          <img
                            src="/plus.png"
                            alt="Add room"
                            className="block object-contain"
                            style={{ width: 17, height: 17, filter: "invert(38%) sepia(31%) saturate(1592%) hue-rotate(101deg) brightness(94%) contrast(80%)" }}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        </button>
                      </div>
                      <div className="p-3">
                        <div className="mb-2 grid grid-cols-[24px_28px_1fr_100px_64px] gap-2 text-[11px] font-bold text-[#8A97A8]">
                          <p></p><p></p><p>Room</p><p className="text-right">Price</p><p className="text-center">Included</p>
                        </div>
                        <div className="space-y-1">
                          {displayedSalesRoomRows.map((room) => (
                            <div key={room.name} className="grid grid-cols-[24px_28px_1fr_100px_64px] items-center gap-2 border-b border-[#DDE4EE] py-2">
                              <button
                                type="button"
                                disabled={salesReadOnly || isSavingSalesRooms}
                                onClick={() => void onDeleteSalesRoom(room.name)}
                                className="h-6 w-6 rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[11px] font-bold text-[#C62828] disabled:cursor-not-allowed disabled:opacity-55"
                              >
                                <X size={11} className="mx-auto" strokeWidth={2.5} />
                              </button>
                              <button
                                type="button"
                                disabled={salesReadOnly || isSavingSalesRooms}
                                onClick={() => startEditingSalesRoom(room.name)}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-[8px] border hover:brightness-95 disabled:opacity-60"
                                style={{ backgroundColor: "#7E9EBB", borderColor: "#2F4E68" }}
                                title="Edit room name"
                              >
                                <img
                                  src="/Edit.png"
                                  alt="Edit"
                                  className="block object-contain"
                                  style={{ width: 13, height: 13, filter: "brightness(0) invert(1)" }}
                                  onError={(e) => {
                                    e.currentTarget.src = "/file.svg";
                                  }}
                                />
                              </button>
                              {salesAccess.edit && editingSalesRoomName === room.name ? (
                                <input
                                  disabled={salesReadOnly || isSavingSalesRooms}
                                  autoFocus
                                  value={editingSalesRoomDraftName}
                                  onChange={(e) => setEditingSalesRoomDraftName(e.currentTarget.value)}
                                  onBlur={() => void commitEditingSalesRoom()}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      void commitEditingSalesRoom();
                                    }
                                    if (e.key === "Escape") {
                                      e.preventDefault();
                                      cancelEditingSalesRoom();
                                    }
                                  }}
                                  className="h-7 w-full rounded-[8px] border border-[#D7DEE8] bg-white px-2 text-[12px] font-semibold text-[#0F172A] disabled:opacity-60"
                                />
                              ) : (
                                <p className="text-[12px] font-semibold text-[#0F172A]">{room.name}</p>
                              )}
                              <p className="text-right text-[12px] font-semibold italic text-[#0F172A]">{room.totalPrice}</p>
                              <label className="inline-flex items-center justify-center gap-1 text-[12px] font-bold">
                                <input
                                  type="checkbox"
                                  disabled={salesReadOnly || isSavingSalesRooms}
                                  checked={Boolean(room.included)}
                                  onChange={(e) => void onToggleSalesRoomIncluded(room.name, e.target.checked)}
                                  className="h-[12px] w-[12px]"
                                />
                                <span style={{ color: room.included ? "#16A34A" : "#DC2626" }}>
                                  {room.included ? "Yes" : "No"}
                                </span>
                              </label>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <button
                            type="button"
                            disabled={salesReadOnly || isSavingSalesRooms}
                            onClick={() => void onAddCutlistRoom()}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-[#A9DDBF] bg-[#EAF8F0] text-[16px] font-bold leading-none text-[#1F8A4C] hover:bg-[#DDF2E7] disabled:opacity-55"
                            title="Add room"
                          >
                            <img
                              src="/plus.png"
                              alt="Add room"
                              className="block object-contain"
                              style={{ width: 17, height: 17, filter: "invert(38%) sepia(31%) saturate(1592%) hue-rotate(101deg) brightness(94%) contrast(80%)" }}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          </button>
                          <p className="text-[36px] font-extrabold text-[#7E9EBB]">{formatCurrencyValue(displayedSalesQuoteFinalTotal)}</p>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                      <div className="flex h-[50px] items-center border-b border-[#D7DEE8] px-4">
                        <p className="text-[14px] font-medium tracking-[1px] text-[#0F2A4A]">PRODUCT</p>
                      </div>
                      <div className="space-y-2 p-4 text-[12px]">
                        {salesProductRows.length > 0 ? (
                          salesProductRows.map((row) => (
                            <label key={row.name} className="flex items-center gap-2 text-[#1F2937]">
                              <input
                                type="checkbox"
                                disabled={salesReadOnly || isSavingSalesRooms}
                                checked={row.selected}
                                onChange={(e) => void onToggleSalesProductSelected(row.name, e.target.checked)}
                                className="h-[12px] w-[12px]"
                              />
                              <span className="font-semibold">{row.name}</span>
                            </label>
                          ))
                        ) : (
                          <p className="text-[12px] text-[#667085]">No products available.</p>
                        )}
                      </div>
                    </section>

                    <section className="rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                      <div className="flex h-[50px] items-center border-b border-[#D7DEE8] px-4">
                        <p className="text-[14px] font-medium tracking-[1px] text-[#0F2A4A]">QUOTE EXTRAS</p>
                      </div>
                      <div className="space-y-2 p-4 text-[12px]">
                        {displayedSalesQuoteExtras.length > 0 ? (
                          displayedSalesQuoteExtras.map((item) => (
                            <label key={item.id} className="flex items-center gap-2 text-[#1F2937]">
                              <input
                                type="checkbox"
                                checked={item.included}
                                disabled={salesReadOnly || isSavingSalesRooms}
                                onChange={(e) => void onToggleSalesQuoteExtraIncluded(item, e.target.checked)}
                                className="h-[12px] w-[12px]"
                              />
                              <span className="font-semibold">{item.name}</span>
                            </label>
                          ))
                        ) : (
                          <p className="text-[12px] text-[#667085]">No quote extras configured.</p>
                        )}
                      </div>
                    </section>
                  </div>

                  {quotes.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Saved Quotes</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-[12px]">
                        {quotes.map((quote) => (
                          <div key={quote.id} className="rounded-[10px] border border-[#DEE4EC] bg-[#F5F6F8] p-3">
                            <p className="font-bold text-[#111827]">{quote.currency} {quote.value.toLocaleString()}</p>
                            <p className="text-[#5B6472]">Stage: {quote.stage}</p>
                            <p className="text-[#5B6472]">Updated: {shortDate(quote.updatedAt)}</p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                  </>
                )}
              </div>
            </div>
          )}

          {resolvedTab === "production" && productionAccess.view && (
            <div className="-mx-4 -mb-4 -mt-4 min-h-[100dvh] items-stretch gap-4 md:-mx-5 xl:grid xl:grid-cols-[170px_1fr]">
              <aside className="h-full overflow-hidden border-b border-[#DCE3EC] px-1 pb-2 sm:overflow-x-auto xl:overflow-hidden xl:border-b-0 xl:border-r xl:px-0 xl:pb-0">
                <div className="flex flex-col items-stretch sm:min-w-max sm:flex-row xl:block xl:min-w-0">
                {[
                  { label: "Cutlist", icon: Scissors, key: "cutlist" as const },
                  { label: "Nesting", icon: GitBranch, key: "nesting" as const },
                  { label: "CNC Cutlist", icon: Cpu, key: "cnc" as const },
                  { label: "Order", icon: ShoppingCart, key: "order" as const },
                  { label: "Unlock Production", icon: Lock, key: "unlock" as const },
                ].map((item, idx, arr) => {
                  const Icon = item.icon;
                  const active = productionNav === item.key;
                  return (
                    <div key={item.label} className="w-full sm:w-auto xl:w-full">
                      <button
                        type="button"
                        disabled={productionReadOnly}
                        onClick={() => {
                          if (item.key === "nesting") {
                            setProductionNav("nesting");
                            setNestingFullscreen(true);
                            return;
                          }
                          setNestingFullscreen(false);
                          setProductionNav(item.key);
                        }}
                        className={`inline-flex w-full min-w-0 items-center gap-2 whitespace-nowrap pl-0 pr-2 py-3 text-left text-[13px] font-semibold sm:w-auto sm:min-w-[120px] xl:w-full xl:min-w-0 xl:whitespace-normal ${
                          active ? "bg-[#EEF2F7] text-[#12345B]" : "text-[#243B58] hover:bg-[#EEF2F7]"
                        } disabled:cursor-not-allowed disabled:opacity-55`}
                      >
                        <span className="pl-4">
                          <Icon size={13} />
                        </span>
                        {item.label}
                      </button>
                      {idx < arr.length - 1 && (
                        <div className="my-0.5 h-px w-full bg-[#DCE3EC] sm:mx-1 sm:my-0 sm:h-auto sm:w-px xl:-ml-px xl:-mr-px xl:h-px xl:w-auto" />
                      )}
                    </div>
                  );
                })}
                </div>
              </aside>

              <div
                className={
                  productionNav === "cutlist" || productionNav === "order"
                    ? "isolate mt-0 w-full min-h-[calc(100dvh-235px)] px-3 sm:px-4 md:px-5 xl:px-0"
                    : "isolate mt-2 w-full max-w-[1120px] space-y-4 px-3 sm:px-4 md:px-5 xl:mt-4 xl:px-0"
                }
              >
                {productionReadOnly && (
                  <div className="rounded-[10px] border border-[#D6DEE9] bg-[#EEF2F7] px-3 py-2 text-[12px] font-semibold text-[#334155]">
                    Production is in read-only mode for your account.
                  </div>
                )}

                {productionNav === "cutlist" ? (
                  <div className="grid h-full min-h-[calc(100dvh-235px)] gap-0 xl:grid-cols-[190px_1fr]">
                    <aside className="border-r border-[#DCE3EC]">
                      <div className="flex h-full flex-col p-2">
                        <p className="mb-2 px-2 text-[16px] font-medium text-[#111827]">Rooms</p>
                        <div className="flex flex-1 flex-col">
                        <div className="space-y-1">
                          {cutlistAddedRoomTabs.map((roomTab) => {
                            const active = cutlistRoomFilter === roomTab.filter;
                            return (
                              <button
                                key={`${roomTab.label}_${roomTab.filter}`}
                                type="button"
                                onClick={() => setCutlistRoomFilter(roomTab.filter)}
                                className={`w-full rounded-[9px] px-2 py-2 text-left text-[12px] font-semibold ${
                                  active ? "bg-[#E9EFF7] text-[#12345B]" : "text-[#334155] hover:bg-[#F1F5F9]"
                                }`}
                              >
                                {roomTab.label}
                              </button>
                            );
                          })}
                          <div className="my-2 h-px bg-[#DCE3EC]" />
                          {cutlistRoomTabs
                            .filter((tab) => tab.filter === "Project Cutlist")
                            .map((roomTab) => {
                              const active = cutlistRoomFilter === roomTab.filter;
                              return (
                                <button
                                  key={`${roomTab.label}_${roomTab.filter}`}
                                  type="button"
                                  onClick={() => setCutlistRoomFilter(roomTab.filter)}
                                  className={`w-full rounded-[9px] px-2 py-2 text-left text-[12px] font-semibold ${
                                    active ? "bg-[#E9EFF7] text-[#12345B]" : "text-[#334155] hover:bg-[#F1F5F9]"
                                  }`}
                                >
                                  {roomTab.label}
                                </button>
                              );
                            })}
                          <button
                            type="button"
                            disabled={!salesAccess.edit || isSavingSalesRooms}
                            onClick={() => void onAddCutlistRoom()}
                            className="mt-2 w-full rounded-[9px] border border-[#BFE8CF] bg-[#DDF2E7] px-2 py-2 text-left text-[12px] font-bold text-[#1F6A3B] disabled:opacity-55"
                          >
                            + Add Room
                          </button>
                        </div>
                          {initialMeasureLargerSheetWarningsByRoom.length > 0 && (
                            <div className="mt-auto pt-3">
                            <div className="rounded-[10px] border border-[#F2D06B] bg-[#FFF4BF] px-2 py-2 text-[#7A5600]">
                              <div className="flex items-center gap-1">
                                <img
                                  src="/danger.png"
                                  alt="Warning"
                                  className="h-[13px] w-[13px] object-contain"
                                  style={{ filter: "brightness(0) saturate(100%) invert(31%) sepia(27%) saturate(1683%) hue-rotate(14deg) brightness(93%) contrast(101%)" }}
                                />
                                <p className="text-[12px] font-semibold">Large sheets used</p>
                              </div>
                              <div className="mt-2 border-t border-[rgba(122,86,0,0.18)] pt-2 space-y-2">
                                {initialMeasureLargerSheetWarningsByRoom.map((roomBlock) => (
                                  <div key={`im_warn_prodtab_${roomBlock.room}`} className="border-b border-[rgba(122,86,0,0.18)] pb-2 last:border-b-0 last:pb-0">
                                    <p className="text-[10px] font-bold">{roomBlock.room}:</p>
                                    <div className="mt-1 space-y-1">
                                      {roomBlock.entries.map((entry, idx) => (
                                        <p key={`im_warn_prodtab_${roomBlock.room}_${entry.productName}_${entry.sheetSize}_${idx}`} className="text-[10px] font-medium text-[#8A6A16]">
                                          {entry.productName} {" | "} {entry.sheetSize} {" | "} {entry.sheetCount > 0 ? `${entry.sheetCount}` : ""} {entry.sheetCount === 1 ? "Sheet" : "Sheets"}
                                        </p>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-2 flex items-center justify-between border-t border-[rgba(122,86,0,0.18)] pt-2">
                                <span className="text-[10px] font-semibold">Added to quote</span>
                                <img
                                  src={salesRoomSheetAnalysis.largerSheetPricingAddedToQuote ? "/tick.png" : "/cross-small.png"}
                                  alt={salesRoomSheetAnalysis.largerSheetPricingAddedToQuote ? "Added to quote" : "Not added to quote"}
                                  className="h-4 w-4 object-contain"
                                  style={{ filter: salesRoomSheetAnalysis.largerSheetPricingAddedToQuote ? "none" : "brightness(0) saturate(100%) invert(18%) sepia(89%) saturate(2660%) hue-rotate(348deg) brightness(92%) contrast(89%)" }}
                                />
                              </div>
                            </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </aside>

                    <div className="flex min-h-full flex-col gap-4 pl-4">
                      {cutlistRoomFilter !== "Project Cutlist" && (
                      <section className="relative z-10 w-full flex-1 overflow-hidden xl:-mx-4 xl:w-[calc(100%+2rem)]">
                        <div className="flex h-[50px] items-center px-1">
                          <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Cutlist Entry</p>
                        </div>
                        <div className="space-y-3 px-0 pb-0">
                          <div className={`flex flex-wrap items-center gap-2 rounded-[8px] px-1 ${warningClassForCell("single", "partType")}`} title={warningForCell("single", "partType") || undefined}>
                            {partTypeOptions.map((v) => {
                              const color = partTypeColors[v] ?? "#CBD5E1";
                              return (
                                <button
                                  key={v}
                                  type="button"
                                  disabled={productionReadOnly}
                                  onClick={() => onSelectCutlistEntryPartType(v)}
                                  style={{
                                    backgroundColor: color,
                                    borderColor: color,
                                    color: isLightHex(color) ? "#1F2937" : "#F8FAFC",
                                  }}
                                  className="rounded-[8px] border px-2 py-1 text-[11px] font-medium disabled:opacity-55"
                                >
                                  {v}
                                </button>
                              );
                            })}
                          </div>

                          <div className="grid gap-2 text-[11px] font-bold text-[#8A97A8]" style={{ gridTemplateColumns: cutlistEntryGridTemplate }}>
                            <p></p>
                            {cutlistEntryColumnDefs.map((col) => (
                              <p
                                key={`single_header_${col.key}`}
                                className={isCenteredCutlistColumn(col.key) ? "text-center" : ""}
                                style={col.key === "clashing" ? cutlistEntryCellStyle("clashing", 2) : cutlistEntryCellStyle(col.key)}
                              >
                                {col.key === "clashing" ? (singleEntryShowsShelvesHeader ? "Shelves" : "Clashing") : col.label}
                              </p>
                            ))}
                          </div>
                          <div className="grid gap-2 border-y px-1 py-1" style={{ gridTemplateColumns: cutlistEntryGridTemplate, backgroundColor: activeCutlistEntryColor, color: activeCutlistEntryTextColor, borderColor: activeCutlistEntryFieldBorder }}>
                            <p></p>
                            <div style={cutlistEntryCellStyle("board")}>
                              <BoardPillDropdown
                                value={cutlistEntry.board}
                                options={cutlistBoardOptions}
                                disabled={productionReadOnly}
                                title={warningForCell("single", "board") || undefined}
                                className={warningClassForCell("single", "board")}
                                bg={warningStyleForCell("single", "board", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }).backgroundColor ?? activeCutlistEntryFieldBg}
                                border={warningStyleForCell("single", "board", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }).borderColor ?? activeCutlistEntryFieldBorder}
                                text={warningStyleForCell("single", "board", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }).color ?? activeCutlistEntryTextColor}
                                getSize={boardSizeFor}
                                getLabel={boardDisplayLabel}
                                onChange={onCutlistEntryBoardChange}
                              />
                            </div>
                            <PartNameSuggestionInput
                              disabled={productionReadOnly}
                              title={warningForCell("single", "name") || undefined}
                              value={cutlistEntry.name}
                              options={productionPartNameSuggestionsForRoom(cutlistEntryRoom, cutlistEntry.name)}
                              onChange={(next) => setCutlistEntry((prev) => ({ ...prev, name: next }))}
                              containerStyle={cutlistEntryCellStyle("name")}
                              className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] ${warningClassForCell("single", "name")}`}
                              style={warningStyleForCell("single", "name", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor })}
                            />
                            {isDrawerPartType(cutlistEntry.partType) ? (
                              <div style={cutlistEntryCellStyle("height")}>
                                <DrawerHeightDropdown
                                  value={String(cutlistEntry.height || "")}
                                  options={drawerHeightLetterOptions}
                                  disabled={productionReadOnly}
                                  title={warningForCell("single", "height") || undefined}
                                  className={warningClassForCell("single", "height")}
                                  bg={warningStyleForCell("single", "height", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }).backgroundColor ?? activeCutlistEntryFieldBg}
                                  border={warningStyleForCell("single", "height", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }).borderColor ?? activeCutlistEntryFieldBorder}
                                  text={warningStyleForCell("single", "height", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }).color ?? activeCutlistEntryTextColor}
                                  onAdd={(token) => addCutlistEntryDrawerHeightToken(token)}
                                  onRemove={(token) => removeCutlistEntryDrawerHeightToken(token)}
                                />
                              </div>
                            ) : (
                              <input disabled={productionReadOnly} inputMode="numeric" pattern="[0-9]*" title={warningForCell("single", "height") || undefined} value={cutlistEntry.height} onChange={(e) => setCutlistEntry((prev) => ({ ...prev, height: numericOnlyText(e.target.value) }))} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center ${warningClassForCell("single", "height")}`} style={{ ...warningStyleForCell("single", "height", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }), ...(singleEntryHeightGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : {}), ...cutlistEntryCellStyle("height") }} />
                            )}
                            <input disabled={productionReadOnly} inputMode="numeric" pattern="[0-9]*" title={warningForCell("single", "width") || undefined} value={cutlistEntry.width} onChange={(e) => setCutlistEntry((prev) => ({ ...prev, width: numericOnlyText(e.target.value) }))} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center ${warningClassForCell("single", "width")}`} style={{ ...warningStyleForCell("single", "width", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }), ...(singleEntryWidthGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : {}), ...cutlistEntryCellStyle("width") }} />
                            <input disabled={productionReadOnly} inputMode="numeric" pattern="[0-9]*" title={warningForCell("single", "depth") || undefined} value={cutlistEntry.depth} onChange={(e) => setCutlistEntry((prev) => ({ ...prev, depth: numericOnlyText(e.target.value) }))} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center ${warningClassForCell("single", "depth")}`} style={{ ...warningStyleForCell("single", "depth", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }), ...(singleEntryDepthGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : {}), ...cutlistEntryCellStyle("depth") }} />
                            <input disabled={productionReadOnly || isDrawerPartType(cutlistEntry.partType)} inputMode="numeric" pattern="[0-9]*" title={warningForCell("single", "quantity") || undefined} value={cutlistEntry.quantity} onChange={(e) => setCutlistEntry((prev) => ({ ...prev, quantity: numericOnlyText(e.target.value) }))} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center disabled:opacity-90 ${warningClassForCell("single", "quantity")}`} style={{ ...warningStyleForCell("single", "quantity", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }), ...cutlistEntryCellStyle("quantity") }} />
                            <div style={cutlistEntrySubCellStyle("clashing", 0)}>
                              <BoardPillDropdown
                                value={cutlistEntry.clashLeft ?? ""}
                                options={CLASH_LEFT_OPTIONS}
                                disabled={productionReadOnly || isDrawerPartType(cutlistEntry.partType)}
                                bg={activeCutlistEntryFieldBg}
                                border={activeCutlistEntryFieldBorder}
                                text={activeCutlistEntryTextColor}
                                size="default"
                                getSize={() => ""}
                                getLabel={(v) => v}
                                onChange={(v) => setCutlistEntry((prev) => ({ ...prev, clashLeft: v }))}
                              />
                            </div>
                            <div style={cutlistEntrySubCellStyle("clashing", 1)}>
                              <BoardPillDropdown
                                value={cutlistEntry.clashRight ?? ""}
                                options={CLASH_RIGHT_OPTIONS}
                                disabled={productionReadOnly || isDrawerPartType(cutlistEntry.partType)}
                                bg={activeCutlistEntryFieldBg}
                                border={activeCutlistEntryFieldBorder}
                                text={activeCutlistEntryTextColor}
                                size="default"
                                getSize={() => ""}
                                getLabel={(v) => v}
                                onChange={(v) => setCutlistEntry((prev) => ({ ...prev, clashRight: v }))}
                              />
                            </div>
                            <div className="grid gap-[2px]" style={cutlistEntryCellStyle("information")}>
                              {informationLinesFromValue(cutlistEntry.information).map((line, idx) => (
                                <div key={`entry_info_${idx}`} className="flex items-center gap-[3px]">
                                  <button
                                    type="button"
                                    disabled={productionReadOnly}
                                    onClick={() => (idx === 0 ? onCutlistEntryAddInformationLine() : onCutlistEntryRemoveInformationLine(idx))}
                                    className={
                                      idx === 0
                                        ? "inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#A9DDBF] bg-[#EAF8F0] text-[20px] font-bold leading-none text-[#1F8A4C] hover:bg-[#DDF2E7] disabled:opacity-55"
                                        : "inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[11px] font-bold text-[#C62828] disabled:opacity-55"
                                    }
                                  >
                                    {idx === 0 ? <Plus size={16} className="mx-auto" strokeWidth={2.8} /> : <X size={15} className="mx-auto" strokeWidth={2.8} />}
                                  </button>
                                  <input
                                    disabled={productionReadOnly}
                                    value={line}
                                    onChange={(e) => onCutlistEntryInformationLineChange(idx, e.target.value)}
                                    placeholder="Information"
                                    className="h-8 flex-1 rounded-[8px] border bg-transparent px-2 text-[12px]"
                                    style={{ backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }}
                                  />
                                </div>
                              ))}
                            </div>
                            {showCutlistGrainColumn && (
                              boardGrainFor(String(cutlistEntry.board ?? "").trim()) ? (
                                <div style={cutlistEntryCellStyle("grain")}>
                                  <BoardPillDropdown
                                    value={String(cutlistEntry.grainValue ?? "")}
                                    options={grainDimensionOptionsForRow(cutlistEntry)}
                                    disabled={productionReadOnly}
                                    bg={activeCutlistEntryFieldBg}
                                    border={activeCutlistEntryFieldBorder}
                                    text={activeCutlistEntryTextColor}
                                    size="default"
                                    getSize={() => ""}
                                    getLabel={(v) => v}
                                    onChange={(v) =>
                                      setCutlistEntry((prev) => ({
                                        ...prev,
                                        grainValue: v,
                                        grain: Boolean(String(v).trim()),
                                      }))
                                    }
                                  />
                                </div>
                              ) : (
                                <div style={cutlistEntryCellStyle("grain")} />
                              )
                            )}
                          </div>
                          <button
                            disabled={productionReadOnly}
                            onClick={() => void addCutlistRow()}
                            className="inline-flex h-[50px] w-full items-center justify-center border-y border-[#BFE8CF] bg-[#DDF2E7] text-[24px] font-extrabold text-[#14532D] disabled:opacity-55"
                          >
                            Add to Cutlist
                          </button>
                        </div>
                      </section>
                      )}

                      <section className="relative z-10 w-full overflow-hidden xl:-mx-4 xl:w-[calc(100%+2rem)]">
                        <div className="flex h-[50px] items-center justify-between px-1">
                          <div className="inline-flex items-center gap-2">
                            <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Cutlist List</p>
                            <p className="rounded-[999px] border border-[#D6DEE9] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#334155]">
                              {formatPartCount(visibleCutlistRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0))}
                            </p>
                          </div>
                          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 pr-1">
                            <input
                              value={cutlistSearch}
                              onChange={(e) => setCutlistSearch(e.target.value)}
                              placeholder="Search part name or board"
                              className="h-8 w-[180px] rounded-[8px] border border-[#D8DEE8] bg-[#EEF1F5] px-2 text-[12px] sm:w-[240px] md:w-[280px]"
                            />
                            <select
                              value={cutlistPartTypeFilter}
                              onChange={(e) => setCutlistPartTypeFilter(e.target.value)}
                              className="h-8 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                            >
                              <option value="All Part Types">All Part Types</option>
                              {partTypeOptions.map((v) => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="flex h-full flex-col space-y-2 px-0 pb-0">
                          <div className="min-h-0 flex-1 overflow-auto bg-transparent">
                            <table className="w-full text-left text-[12px]">
                            <thead className="bg-[#F8FAFC] text-[#1F2937]">
                              <tr>
                                <th className="w-[34px] px-2 py-2"></th>
                                {showRoomColumnInList && (
                                  <th className="px-2 py-2" style={{ width: 150, minWidth: 150 }}>Room</th>
                                )}
                                {cutlistListColumnDefs.map((col) => (
                                  (() => {
                                    const headerLabel = col.key === "clashing" && flatListShowsShelvesHeader ? "Shelves" : col.label;
                                    return (
                                  <th
                                    key={col.label}
                                    className={`px-2 py-2 ${cutlistHeaderAlignClass(col.key as CutlistEditableField)}`}
                                    style={cutlistListColumnStyle(col.key as CutlistEditableField)}
                                  >
                                    {headerLabel}
                                  </th>
                                    );
                                  })()
                                ))}
                              </tr>
                            </thead>
                              <tbody>
                                {visibleCutlistRows.map((row) => {
                                  const rowPartColor = partTypeColors[row.partType || "Unassigned"] ?? "#CBD5E1";
                                  const rowPalette = groupColorPalette(rowPartColor);
                                  const rowTextColor = rowPalette.text;
                                  return (
                                  <tr key={row.id} className="border-t" style={{ backgroundColor: rowPalette.rowBg, color: rowTextColor, borderTopColor: rowPartColor }}>
                                    <td className="px-2 py-[3px] align-middle">
                                      <button
                                        disabled={productionReadOnly}
                                        onClick={() => void removeCutlistRow(row.id)}
                                        className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828] disabled:opacity-55"
                                      >
                                        <X size={11} strokeWidth={2.5} />
                                      </button>
                                    </td>
                                    {showRoomColumnInList && (
                                      <td
                                        className="px-2 py-[3px] align-middle"
                                        onDoubleClick={() => startCellEdit(row, "room")}
                                        style={{ width: 150, minWidth: 150, color: rowTextColor }}
                                      >
                                        {isEditing(row.id, "room") ? (
                                          <select
                                            autoFocus
                                            value={editingCellValue}
                                            onChange={(e) => setEditingCellValue(e.target.value)}
                                            onBlur={() => void commitCellEdit()}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                void commitCellEdit();
                                              }
                                              if (e.key === "Escape") cancelCellEdit();
                                            }}
                                            className="h-6 w-full min-w-0 max-w-full rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                          >
                                            {cutlistEntryRoomOptions.map((opt) => (
                                              <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                          </select>
                                        ) : (
                                          row.room
                                        )}
                                      </td>
                                    )}
                                    {cutlistListColumnDefs.map((col) => {
                                      const key = col.key as CutlistEditableField;
                                      const editing = isEditing(row.id, key);
                                      const alignClass = cutlistCellAlignClass(key);
                                      if (col.key === "partType") {
                                        const options = Array.from(new Set([row.partType, ...partTypeOptions].filter(Boolean)));
                                        const rowPartColor = partTypeColors[row.partType || "Unassigned"] ?? "#CBD5E1";
                                        const rowPartTextColor = isLightHex(rowPartColor) ? "#000000" : "#FFFFFF";
                                        return (
                                          <td
                                            key={`${row.id}_${col.label}`}
                                            className={`px-2 py-[3px] align-middle ${alignClass}`}
                                            onDoubleClick={() => startCellEdit(row, "partType")}
                                            style={{ ...cutlistListColumnStyle("partType"), color: rowTextColor }}
                                          >
                                            {editing ? (
                                              <select
                                                autoFocus
                                                value={editingCellValue}
                                                onChange={(e) => setEditingCellValue(e.target.value)}
                                                onBlur={() => void commitCellEdit()}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    void commitCellEdit();
                                                  }
                                                  if (e.key === "Escape") cancelCellEdit();
                                                }}
                                                className="h-6 w-full min-w-0 max-w-full rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                              >
                                                <option value=""></option>
                                                {options.map((opt) => (
                                                  <option key={opt} value={opt}>
                                                    {`${boardSizeFor(opt) ? `${boardSizeFor(opt)} ` : ""}${boardDisplayLabel(opt)}`}
                                                  </option>
                                                ))}
                                              </select>
                                            ) : (
                                              <button
                                                type="button"
                                                disabled={productionReadOnly}
                                                onClick={() => startCellEdit(row, "partType")}
                                                className="inline-flex rounded-[8px] border px-2 py-[2px] text-[11px] font-medium disabled:opacity-60"
                                                style={{
                                                  borderColor: rowPartColor,
                                                  backgroundColor: rowPartColor,
                                                  color: rowPartTextColor,
                                                }}
                                              >
                                                {row.partType || "Unassigned"}
                                              </button>
                                            )}
                                          </td>
                                        );
                                      }
                                      if (col.key === "board") {
                                        const options = Array.from(new Set([row.board, ...cutlistBoardOptions].filter(Boolean)));
                                        const rowPartTextColor = isLightHex(rowPartColor) ? "#000000" : "#FFFFFF";
                                        return (
                                          <td
                                            key={`${row.id}_${col.label}`}
                                            className={`px-2 py-[3px] align-middle ${alignClass}`}
                                            onDoubleClick={() => startCellEdit(row, "board")}
                                            style={{ ...cutlistListColumnStyle("board"), color: rowTextColor }}
                                          >
                                            {editing ? (
                                              <BoardPillDropdown
                                                value={editingCellValue}
                                                options={options}
                                                disabled={productionReadOnly}
                                                bg="#FFFFFF"
                                                border="#94A3B8"
                                                text="#0F172A"
                                                size="compact"
                                                getSize={boardSizeFor}
                                                getLabel={boardDisplayLabel}
                                                onChange={(next) => {
                                                  setEditingCellValue(next);
                                                  void commitCellEdit(next);
                                                }}
                                              />
                                            ) : (
                                              <div className="inline-flex items-center gap-2">
                                                {boardSizeFor(row.board) && (
                                                  <span
                                                    className="inline-flex h-5 min-w-[28px] items-center justify-center rounded-[999px] px-2 text-[10px] font-bold"
                                                    style={{ backgroundColor: darkenHex(rowPartColor, 0.15), color: rowPartTextColor }}
                                                  >
                                                    {boardSizeFor(row.board)}
                                                  </span>
                                                )}
                                                <span>{boardDisplayLabel(row.board)}</span>
                                              </div>
                                            )}
                                          </td>
                                        );
                                      }
                                    if (col.key === "grain") {
                                        const rowBoardAllowsGrain = boardGrainFor(String(row.board ?? "").trim());
                                        return (
                                          <td
                                            key={`${row.id}_${col.label}`}
                                            className={`px-2 py-[3px] align-middle ${alignClass}`}
                                            onDoubleClick={() => {
                                              if (!rowBoardAllowsGrain) return;
                                              startCellEdit(row, "grain");
                                            }}
                                            style={{ ...cutlistListColumnStyle("grain"), color: rowTextColor }}
                                          >
                                            {!rowBoardAllowsGrain ? "" : editing ? (
                                              <BoardPillDropdown
                                                value={editingCellValue}
                                                options={grainDimensionOptionsForRow(row)}
                                                disabled={productionReadOnly}
                                                bg="#FFFFFF"
                                                border="#94A3B8"
                                                text="#0F172A"
                                                size="compact"
                                                getSize={() => ""}
                                                getLabel={(v) => v}
                                                onChange={(v) => {
                                                  setEditingCellValue(v);
                                                  void commitCellEdit(v);
                                                }}
                                              />
                                            ) : (
                                              row.grainValue || (row.grain ? "Yes" : "")
                                            )}
                                          </td>
                                        );
                                      }
                                      if (col.key === "clashing") {
                                        const rowIsCabinetry = isCabinetryPartType(row.partType);
                                        return (
                                          <td
                                            key={`${row.id}_${col.label}`}
                                            className={`px-2 py-[3px] align-middle ${alignClass}`}
                                            onDoubleClick={() => startCellEdit(row, "clashing")}
                                            style={{ ...cutlistListColumnStyle("clashing"), color: rowTextColor }}
                                          >
                                            {editing ? (
                                              rowIsCabinetry ? (
                                                <div data-cutlist-cabinetry-edit={row.id} className="grid min-h-[78px] content-center gap-[1px] text-left">
                                                  <div className="-mt-[2px] grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                    <span className="block pr-[3px] text-right text-[9px] font-bold leading-none">Fixed Shelf</span>
                                                    <input
                                                      autoFocus
                                                      value={editingFixedShelf}
                                                      inputMode="numeric"
                                                      pattern="[0-9]*"
                                                      onChange={(e) => {
                                                        const next = numericOnlyText(e.target.value);
                                                        editingFixedShelfRef.current = next;
                                                        setEditingFixedShelf(next);
                                                      }}
                                                      onBlur={(e) => onCabinetryShelfInputBlur(e, row.id)}
                                                      onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                          e.preventDefault();
                                                          const nextRoot = e.currentTarget.closest(`[data-cutlist-cabinetry-edit="${row.id}"]`) as HTMLElement | null;
                                                          const nextTarget = nextRoot?.querySelector('[data-cutlist-drilling="fixed"] button') as HTMLButtonElement | null;
                                                          if (hasShelfQuantity(editingFixedShelf) && nextTarget) {
                                                            nextTarget.focus();
                                                            return;
                                                          }
                                                          void commitCellEdit();
                                                        }
                                                        if (e.key === "Escape") cancelCellEdit();
                                                      }}
                                                    className="h-[18px] w-full min-w-0 rounded-[5px] border border-[#94A3B8] bg-white px-1 text-[9px] text-[#0F172A]"
                                                    />
                                                  </div>
                                                  <div className="-mt-[2px] grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                    {hasShelfQuantity(editingFixedShelf) ? (
                                                      <>
                                                        <span className="inline-flex w-full items-center justify-end gap-[2px] pr-[3px] text-[9px] font-bold leading-none">
                                                          <DrillingArrowIcon color={rowTextColor} />
                                                          Drilling
                                                        </span>
                                                        <div data-cutlist-drilling="fixed" className="w-full min-w-0">
                                                          <BoardPillDropdown
                                                            value={editingFixedShelfDrilling}
                                                            options={DRILLING_OPTIONS}
                                                            disabled={productionReadOnly}
                                                            bg="#FFFFFF"
                                                            border="#94A3B8"
                                                            text="#0F172A"
                                                            size="compact"
                                                            className="!h-[18px] !rounded-[5px] !text-[9px]"
                                                            getSize={() => ""}
                                                            getLabel={(v) => v}
                                                            onChange={(v) => {
                                                              const next = normalizeDrillingValue(v);
                                                              editingFixedShelfDrillingRef.current = next;
                                                              setEditingFixedShelfDrilling(next);
                                                              window.setTimeout(() => {
                                                                void commitCellEdit();
                                                              }, 0);
                                                            }}
                                                          />
                                                        </div>
                                                      </>
                                                    ) : (
                                                      <>
                                                        <span></span>
                                                        <span></span>
                                                      </>
                                                    )}
                                                  </div>
                                                  <div className="grid h-[18px] grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                    <span className="block pr-[3px] text-right text-[9px] font-bold leading-none">Adjustable Shelf</span>
                                                    <input
                                                      value={editingAdjustableShelf}
                                                      inputMode="numeric"
                                                      pattern="[0-9]*"
                                                      onChange={(e) => {
                                                        const next = numericOnlyText(e.target.value);
                                                        editingAdjustableShelfRef.current = next;
                                                        setEditingAdjustableShelf(next);
                                                      }}
                                                      onBlur={(e) => onCabinetryShelfInputBlur(e, row.id)}
                                                      onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                          e.preventDefault();
                                                          const nextRoot = e.currentTarget.closest(`[data-cutlist-cabinetry-edit="${row.id}"]`) as HTMLElement | null;
                                                          const nextTarget = nextRoot?.querySelector('[data-cutlist-drilling="adjustable"] button') as HTMLButtonElement | null;
                                                          if (hasShelfQuantity(editingAdjustableShelf) && nextTarget) {
                                                            nextTarget.focus();
                                                            return;
                                                          }
                                                          void commitCellEdit();
                                                        }
                                                        if (e.key === "Escape") cancelCellEdit();
                                                      }}
                                                    className="h-[18px] w-full min-w-0 rounded-[5px] border border-[#94A3B8] bg-white px-1 text-[9px] text-[#0F172A]"
                                                    />
                                                  </div>
                                                  <div className="-mt-[2px] grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                    {hasShelfQuantity(editingAdjustableShelf) ? (
                                                      <>
                                                        <span className="inline-flex w-full items-center justify-end gap-[2px] pr-[3px] text-[9px] font-bold leading-none">
                                                          <DrillingArrowIcon color={rowTextColor} />
                                                          Drilling
                                                        </span>
                                                        <div data-cutlist-drilling="adjustable" className="w-full min-w-0">
                                                          <BoardPillDropdown
                                                            value={editingAdjustableShelfDrilling}
                                                            options={DRILLING_OPTIONS}
                                                            disabled={productionReadOnly}
                                                            bg="#FFFFFF"
                                                            border="#94A3B8"
                                                            text="#0F172A"
                                                            size="compact"
                                                            className="!h-[18px] !rounded-[5px] !text-[9px]"
                                                            getSize={() => ""}
                                                            getLabel={(v) => v}
                                                            onChange={(v) => {
                                                              const next = normalizeDrillingValue(v);
                                                              editingAdjustableShelfDrillingRef.current = next;
                                                              setEditingAdjustableShelfDrilling(next);
                                                              window.setTimeout(() => {
                                                                void commitCellEdit();
                                                              }, 0);
                                                            }}
                                                          />
                                                        </div>
                                                      </>
                                                    ) : (
                                                      <>
                                                        <span></span>
                                                        <span></span>
                                                      </>
                                                    )}
                                                  </div>
                                                </div>
                                              ) : (
                                              <div className="grid grid-cols-2 gap-1">
                                                  <BoardPillDropdown
                                                    value={editingClashLeft}
                                                    options={CLASH_LEFT_OPTIONS}
                                                    disabled={productionReadOnly || isDrawerPartType(row.partType)}
                                                    bg="#FFFFFF"
                                                    border="#94A3B8"
                                                    text="#0F172A"
                                                    size="compact"
                                                    matchDrawerArrow={isDrawerPartType(row.partType)}
                                                    getSize={() => ""}
                                                    getLabel={(v) => v}
                                                    onChange={(next) => setEditingClashLeft(next)}
                                                  />
                                                  <BoardPillDropdown
                                                    value={editingClashRight}
                                                    options={CLASH_RIGHT_OPTIONS}
                                                    disabled={productionReadOnly || isDrawerPartType(row.partType)}
                                                    bg="#FFFFFF"
                                                    border="#94A3B8"
                                                    text="#0F172A"
                                                    size="compact"
                                                    matchDrawerArrow={isDrawerPartType(row.partType)}
                                                    getSize={() => ""}
                                                    getLabel={(v) => v}
                                                    onChange={(next) => {
                                                      setEditingClashRight(next);
                                                      window.setTimeout(() => {
                                                        void commitCellEdit();
                                                      }, 0);
                                                    }}
                                                  />
                                                </div>
                                              )
                                            ) : (
                                              rowIsCabinetry ? (
                                                <div className="grid min-h-[78px] content-center gap-[1px] text-left text-[9px]">
                                                  <div className="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                    <span className="block pr-[3px] text-right font-bold">Fixed Shelf</span>
                                                    <span>{row.fixedShelf || ""}</span>
                                                  </div>
                                                  {hasShelfQuantity(row.fixedShelf) && (
                                                    <div className="-mt-[2px] grid h-[18px] grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                      <span className="inline-flex w-full items-center justify-end gap-[2px] pr-[3px] font-bold">
                                                        <DrillingArrowIcon color={rowTextColor} />
                                                        Drilling
                                                      </span>
                                                      <span>{normalizeDrillingValue(row.fixedShelfDrilling)}</span>
                                                    </div>
                                                  )}
                                                  <div className="grid h-[18px] grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                    <span className="block pr-[3px] text-right font-bold">Adjustable Shelf</span>
                                                    <span>{row.adjustableShelf || ""}</span>
                                                  </div>
                                                  {hasShelfQuantity(row.adjustableShelf) && (
                                                    <div className="-mt-[2px] grid h-[18px] grid-cols-[78px_minmax(0,1fr)] items-center gap-[4px]">
                                                      <span className="inline-flex w-full items-center justify-end gap-[2px] pr-[3px] font-bold">
                                                        <DrillingArrowIcon color={rowTextColor} />
                                                        Drilling
                                                      </span>
                                                      <span>{normalizeDrillingValue(row.adjustableShelfDrilling)}</span>
                                                    </div>
                                                  )}
                                                </div>
                                              ) : (
                                                row.clashing
                                              )
                                            )}
                                          </td>
                                        );
                                      }
                                      if (col.key === "information") {
                                        const infoLines = informationLinesFromValue(String(row.information ?? ""));
                                        return (
                                          <td
                                            key={`${row.id}_${col.label}`}
                                            className={`px-2 py-[3px] align-middle ${alignClass}`}
                                            onDoubleClick={() => startCellEdit(row, key)}
                                            style={{ ...cutlistListColumnStyle(key), color: rowTextColor }}
                                          >
                                            {editing ? (
                                              <div className="grid gap-[2px]">
                                                {informationLinesFromValue(editingCellValue).map((line, idx) => (
                                                  <div key={`${row.id}_edit_info_small_${idx}`} className="flex items-center gap-[3px]">
                                                    <button
                                                      type="button"
                                                      onClick={() => (idx === 0 ? onEditingAddInformationLine() : onEditingRemoveInformationLine(idx))}
                                                      className={
                                                        idx === 0
                                                          ? "inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#A9DDBF] bg-[#EAF8F0] text-[#1F8A4C] hover:bg-[#DDF2E7]"
                                                          : "inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828]"
                                                      }
                                                    >
                                                      {idx === 0 ? <Plus size={16} className="mx-auto" strokeWidth={2.8} /> : <X size={15} className="mx-auto" strokeWidth={2.8} />}
                                                    </button>
                                                    <input
                                                      autoFocus={idx === 0}
                                                      value={line}
                                                      onChange={(e) => onEditingInformationLineChange(idx, e.target.value)}
                                                      onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                          e.preventDefault();
                                                          void commitCellEdit();
                                                        }
                                                        if (e.key === "Escape") cancelCellEdit();
                                                      }}
                                                      className="h-7 w-full rounded-[6px] border border-[#94A3B8] bg-white px-2 text-[11px] text-[#0F172A]"
                                                    />
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <div className="space-y-[2px]">
                                                {infoLines.map((line, idx) => (
                                                  <div key={`${row.id}_info_inline_small_${idx}`} className="leading-[1.2]">
                                                    {line}
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </td>
                                        );
                                      }
                                      const value = String(row[col.key] ?? "");
                                      const isGrainMatchedDimension =
                                        (key === "height" && matchesGrainDimension(String(row.grainValue ?? ""), row.height, "height")) ||
                                        (key === "width" && matchesGrainDimension(String(row.grainValue ?? ""), row.width, "width")) ||
                                        (key === "depth" && matchesGrainDimension(String(row.grainValue ?? ""), row.depth, "depth"));
                                      const drawerTextboxLift =
                                        isDrawerPartType(row.partType) && (key === "width" || key === "depth" || key === "quantity");
                                      return (
                                        <td
                                          key={`${row.id}_${col.label}`}
                                          className={`px-2 py-[3px] align-middle ${alignClass}`}
                                          onDoubleClick={() => startCellEdit(row, key)}
                                          style={{
                                            ...cutlistListColumnStyle(key),
                                            color: rowTextColor,
                                            ...(isGrainMatchedDimension ? { fontWeight: 700, textDecoration: "underline" } : {}),
                                          }}
                                        >
                                          {editing ? (
                                            key === "name" ? (
                                              <PartNameSuggestionInput
                                                autoFocus
                                                value={editingCellValue}
                                                options={productionPartNameSuggestionsForRoom(row.room, row.name)}
                                                onChange={(next) => setEditingCellValue(next)}
                                                onBlur={() => void commitCellEdit()}
                                                onCommit={() => void commitCellEdit()}
                                                onCancel={cancelCellEdit}
                                                className={`h-6 w-full rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A] ${alignClass}`}
                                              />
                                            ) : (
                                              <input
                                                autoFocus
                                                value={editingCellValue}
                                                inputMode={isNumericCutlistInputKey(key) ? "numeric" : undefined}
                                                pattern={isNumericCutlistInputKey(key) ? "[0-9]*" : undefined}
                                                onChange={(e) => setEditingCellValue(isNumericCutlistInputKey(key) ? numericOnlyText(e.target.value) : e.target.value)}
                                                onBlur={() => void commitCellEdit()}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    void commitCellEdit();
                                                  }
                                                  if (e.key === "Escape") cancelCellEdit();
                                                }}
                                                style={drawerTextboxLift ? { transform: "translateY(-2px)" } : undefined}
                                                className={`h-6 w-full rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A] ${alignClass}`}
                                              />
                                            )
                                          ) : (
                                            isGrainMatchedDimension ? (
                                              <span>{value}</span>
                                            ) : (
                                              value
                                            )
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                )})}
                                {visibleCutlistRows.length === 0 && (
                                  <tr>
                                    <td colSpan={cutlistListColumnDefs.length + (showRoomColumnInList ? 2 : 1)} className="px-3 py-6 text-center text-[12px] text-[#7A8798]">
                                      No cutlist rows yet.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </section>
                    </div>
                  </div>
                ) : productionNav === "nesting" && !isNestingFullscreen ? (
                  <div className="grid h-full min-h-[calc(100dvh-235px)] gap-3 xl:grid-cols-[1fr_340px]">
                    <section className="flex min-h-0 flex-col gap-3">
                      <div className="flex h-[52px] items-center justify-between rounded-[14px] border border-[#D7DEE8] bg-white px-4">
                        <div className="inline-flex items-center gap-2">
                          <GitBranch size={16} className="text-[#12345B]" />
                          <p className="text-[13px] font-medium uppercase tracking-[1px] text-[#12345B]">Nesting</p>
                          <span className="text-[12px] font-bold text-[#6B7280]">|</span>
                          <p className="text-[13px] font-bold text-[#334155]">{project?.name || "Project"}</p>
                        </div>
                        <div className="inline-flex items-center gap-4 text-[12px] font-semibold text-[#475569]">
                          <span>Sheets: {nestingSummary.sheets}</span>
                          <span>Pieces: {nestingSummary.totalPieces}</span>
                          {nestingSummary.hiddenPieces > 0 && <span>Hidden: {nestingSummary.hiddenPieces}</span>}
                        </div>
                      </div>

                      <section className="min-h-0 overflow-auto rounded-[14px] border border-[#D7DEE8] bg-white">
                        <div className="flex h-[46px] items-center justify-between border-b border-[#DCE3EC] px-4">
                          <div className="inline-flex items-center gap-3 text-[12px] font-semibold text-[#475569]">
                            <span>Sheet H: {formatMm(nestingSettings.sheetHeight)} mm</span>
                            <span>Sheet W: {formatMm(nestingSettings.sheetWidth)} mm</span>
                            <span>Kerf: {formatMm(nestingSettings.kerf)} mm</span>
                            <span>Margin: {formatMm(nestingSettings.margin)} mm</span>
                          </div>
                          <button
                            type="button"
                            disabled={productionReadOnly}
                            onClick={() => {
                              setProductionNav("cutlist");
                              setCutlistRoomFilter("Project Cutlist");
                            }}
                            className="rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] px-3 py-1 text-[12px] font-bold text-[#44688F] disabled:opacity-55"
                          >
                            Edit In Cutlist
                          </button>
                        </div>
                        <div className="space-y-3 p-3">
                          {nestingRowsByBoard.length === 0 && (
                            <div className="rounded-[10px] border border-dashed border-[#D8DEE8] bg-[#F8FAFC] px-3 py-8 text-center text-[12px] font-semibold text-[#667085]">
                              No visible nesting pieces. Toggle visibility on the right panel.
                            </div>
                          )}
                          {nestingRowsByBoard.map((group) => {
                            const collapsed = Boolean(nestingCollapsedGroups[group.boardKey]);
                            const qtySum = group.rows.reduce((sum, row) => sum + Math.max(1, Number.parseInt(String(row.quantity || "1"), 10) || 1), 0);
                            return (
                              <div key={group.boardKey} className="overflow-hidden rounded-[12px] border border-[#D7DEE8]">
                                <div className="flex h-[40px] items-center justify-between bg-[#F8FAFC] pl-3">
                                  <div className="inline-flex items-center gap-2">
                                    <p className="text-[13px] font-medium text-[#12345B]">{group.boardLabel}</p>
                                    <span className="rounded-[999px] bg-[#E9EEF6] px-2 py-[1px] text-[11px] font-bold text-[#395174]">
                                      {formatPartCount(qtySum)}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => toggleNestingGroup(group.boardKey)}
                                    className="inline-flex h-[40px] w-[46px] items-center justify-center border-l border-[#DCE3EC] text-[#12345B] hover:bg-[#EEF2F7]"
                                  >
                                    {collapsed ? <Plus size={16} strokeWidth={2.5} /> : <Minus size={16} strokeWidth={2.5} />}
                                  </button>
                                </div>
                                {!collapsed && (
                                  <div className="overflow-auto">
                                    <table className="w-full text-left text-[12px]">
                                      <thead className="bg-[#FDF1C9] text-[#0F172A]">
                                        <tr>
                                          <th className="px-2 py-2">Room</th>
                                          <th className="px-2 py-2">Part Type</th>
                                          <th className="px-2 py-2">Part Name</th>
                                          <th className="px-2 py-2 text-center">Height</th>
                                          <th className="px-2 py-2 text-center">Width</th>
                                          <th className="px-2 py-2 text-center">Depth</th>
                                          <th className="px-2 py-2 text-center">Qty</th>
                                          <th className="px-2 py-2">Information</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.rows.map((row) => (
                                          <tr key={`${group.boardKey}_${row.id}`} className="border-t border-[#E4E7EE]">
                                            <td className="px-2 py-[6px] text-[#334155]">{row.room || "-"}</td>
                                            <td className="px-2 py-[6px]">
                                              <span
                                                className="inline-flex rounded-[7px] px-2 py-[1px] text-[11px] font-semibold"
                                                style={{
                                                  backgroundColor: partTypeColors[row.partType || "Unassigned"] ?? "#CBD5E1",
                                                  color: isLightHex(partTypeColors[row.partType || "Unassigned"] ?? "#CBD5E1") ? "#111827" : "#F8FAFC",
                                                }}
                                              >
                                                {row.partType || "Unassigned"}
                                              </span>
                                            </td>
                                            <td className="px-2 py-[6px] font-semibold text-[#111827]">{row.name || "-"}</td>
                                            <td className="px-2 py-[6px] text-center text-[#334155]">{row.height || "-"}</td>
                                            <td className="px-2 py-[6px] text-center text-[#334155]">{row.width || "-"}</td>
                                            <td className="px-2 py-[6px] text-center text-[#334155]">{row.depth || "-"}</td>
                                            <td className="px-2 py-[6px] text-center text-[#334155]">{row.quantity || "1"}</td>
                                            <td className="px-2 py-[6px] text-[#475569]">{row.information || "-"}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    </section>

                    <section className="min-h-0 overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white">
                      <div className="flex h-[46px] items-center justify-between border-b border-[#DCE3EC] px-3">
                        <p className="text-[13px] font-medium text-[#111827]">Edit Visibility</p>
                        <button
                          type="button"
                          disabled={productionReadOnly}
                          onClick={() => void onShowAllNestingRows()}
                          className="rounded-[8px] border border-[#D8DEE8] bg-white px-2 py-1 text-[11px] font-bold text-[#334155] disabled:opacity-55"
                        >
                          Show All
                        </button>
                      </div>
                      <div className="p-3">
                        <input
                          value={nestingSearch}
                          onChange={(e) => setNestingSearch(e.target.value)}
                          placeholder="Search pieces..."
                          className="h-8 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                        />
                      </div>
                      <div className="h-[calc(100%-94px)] overflow-auto px-3 pb-3">
                        <div className="space-y-1">
                          {cutlistRows
                            .filter((row) => {
                              const q = String(nestingSearch || "").trim().toLowerCase();
                              if (!q) return true;
                              return [row.name, row.board, row.partType, row.room, row.information]
                                .some((v) => String(v || "").toLowerCase().includes(q));
                            })
                            .map((row) => {
                              const checked = typeof nestingVisibilityMap[row.id] === "boolean"
                                ? nestingVisibilityMap[row.id]
                                : row.includeInNesting !== false;
                              return (
                                <label key={`nest_vis_${row.id}`} className="flex items-start gap-2 rounded-[8px] border border-[#E3E8F0] bg-[#F8FAFC] px-2 py-2">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={productionReadOnly}
                                    onChange={(e) => void onToggleNestingVisibility(row.id, e.target.checked)}
                                    className="mt-[2px] h-4 w-4"
                                  />
                                  <span className="min-w-0 text-[11px] text-[#334155]">
                                    <span className="block truncate font-bold text-[#0F172A]">{row.name || "Part"}</span>
                                    <span className="block truncate">{row.partType || "Unassigned"} â€¢ {boardDisplayLabel(row.board) || "No board"} â€¢ {row.room || "-"}</span>
                                  </span>
                                </label>
                              );
                            })}
                          {cutlistRows.length === 0 && (
                            <p className="rounded-[10px] border border-dashed border-[#D8DEE8] px-3 py-4 text-center text-[12px] font-semibold text-[#64748B]">
                              No cutlist rows yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </section>
                  </div>
                ) : productionNav === "order" ? (
                  <div className="flex h-full min-h-[calc(100dvh-235px)] flex-col gap-3">
                    <div className="sticky top-0 z-[20] flex h-[56px] items-center justify-between border border-[#D7DEE8] bg-white px-4">
                      <div className="inline-flex items-center gap-2">
                        <ShoppingCart size={15} className="text-[#12345B]" />
                        <p className="text-[14px] font-bold uppercase tracking-[1px] text-[#12345B]">Order</p>
                        <span className="text-[12px] font-bold text-[#6B7280]">|</span>
                        <p className="text-[13px] font-bold text-[#334155]">{project?.name || "Project"}</p>
                      </div>
                      <div className="inline-flex items-center gap-4 text-[12px] font-semibold text-[#475569]">
                        <span>{formatPartCount(cutlistRows.length)}</span>
                        <span>{orderTotalSheetsRequired} Sheets Required</span>
                      </div>
                    </div>

                    <div className="grid min-h-0 flex-1 gap-3">
                      <section className="min-h-0 overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                        <div className="flex h-[46px] items-center justify-between border-b border-[#DCE3EC] bg-[#F8FAFC] px-4">
                          <p className="text-[13px] font-medium uppercase tracking-[1px] text-[#12345B]">Boards To Order</p>
                          <span className="rounded-[999px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[1px] text-[11px] font-bold text-[#3A506F]">
                            {orderBoardSummary.length} Rows
                          </span>
                        </div>
                        <div className="max-h-[calc(100dvh-390px)] overflow-auto">
                          <table className="w-full text-left text-[12px]">
                            <thead className="bg-[#FDF1C9] text-[#0F172A]">
                              <tr>
                                <th className="px-3 py-2">Board</th>
                                <th className="px-2 py-2 text-center">Size</th>
                                <th className="px-2 py-2 text-center">Thickness</th>
                                <th className="px-2 py-2 text-center">Finish</th>
                                <th className="px-2 py-2 text-center">Sheets</th>
                              </tr>
                            </thead>
                            <tbody>
                              {orderBoardSummary.map((row, idx) => (
                                <tr key={`order_board_${row.id}`} className={`${idx % 2 ? "bg-[#F8FAFD]" : "bg-white"} border-t border-[#E4E7EE]`}>
                                  <td className="px-3 py-[7px] font-semibold text-[#1F2937]">{row.boardLabel}</td>
                                  <td className="px-2 py-[7px] text-center text-[#334155]">{row.boardSize}</td>
                                  <td className="px-2 py-[7px] text-center text-[#334155]">{row.thickness}</td>
                                  <td className="px-2 py-[7px] text-center text-[#334155]">{row.finish}</td>
                                  <td className="px-2 py-[7px] text-center">
                                    <span className="inline-flex min-w-[28px] justify-center rounded-[8px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[1px] font-bold text-[#2F4E68]">
                                      {row.sheetsRequired}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                              {orderBoardSummary.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="px-3 py-8 text-center text-[12px] font-semibold text-[#64748B]">
                                    No board order data yet.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    </div>
                  </div>
                ) : (
                  <>
                <div className="grid gap-4 xl:grid-cols-[1fr_1.35fr_1.05fr]">
                  <section className="relative z-10 overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                    <div className="flex h-[50px] items-center border-b border-[#DCE3EC] bg-white px-4">
                      <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Existing</p>
                    </div>
                    <div className="space-y-2 p-3 text-[12px]">
                      {[
                        { label: "Carcass Thickness", key: "carcassThickness" as const },
                        { label: "Panel Thickness", key: "panelThickness" as const },
                        { label: "Fronts Thickness", key: "frontsThickness" as const },
                      ].map((item) => (
                        <div key={item.key} className="grid grid-cols-[1fr_78px_26px] items-center gap-2">
                          <p className="font-semibold text-[#334155]">{item.label}</p>
                          <select
                            disabled={productionReadOnly}
                            value={productionForm.existing[item.key]}
                            onChange={(e) => void onChangeExisting(item.key, e.target.value)}
                            className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] text-[#344054]"
                          >
                            <option value=""></option>
                            {boardThicknessOptions.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          <p className="font-semibold text-[#8A97A8]">mm</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="relative z-10 overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                    <div className="flex h-[50px] items-center border-b border-[#DCE3EC] bg-white px-4">
                      <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Cabinetry</p>
                    </div>
                    <div className="space-y-2 p-3 text-[12px]">
                      {[
                        { label: "Base Cab Height", key: "baseCabHeight" as const },
                        { label: "Foot Distance Back", key: "footDistanceBack" as const },
                        { label: "Tall Cab Height", key: "tallCabHeight" as const },
                        { label: "Foot Height", key: "footHeight" as const },
                      ].map((item) => (
                        <div key={item.key} className="grid grid-cols-[1fr_58px_26px] items-center gap-2">
                          <p className="font-semibold text-[#334155]">{item.label}</p>
                          <input
                            disabled={productionReadOnly}
                            value={productionForm.cabinetry[item.key]}
                            onChange={(e) => onCabinetryDraftChange(item.key, e.target.value)}
                            onBlur={() => void onCabinetryBlurSave()}
                            className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                          />
                          <p className="font-semibold text-[#8A97A8]">mm</p>
                        </div>
                      ))}
                      <div className="grid grid-cols-[1fr_58px_26px_58px] items-center gap-2">
                        <p className="font-semibold text-[#334155]">Hob Centre</p>
                        <input
                          disabled={productionReadOnly}
                          value={productionForm.cabinetry.hobCentre}
                          onChange={(e) => onCabinetryDraftChange("hobCentre", e.target.value)}
                          onBlur={() => void onCabinetryBlurSave()}
                          className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                        />
                        <p className="font-semibold text-[#8A97A8]">mm</p>
                        <select
                          disabled={productionReadOnly}
                          value={productionForm.cabinetry.hobSide}
                          onChange={(e) => onCabinetryDraftChange("hobSide", e.target.value)}
                          onBlur={() => void onCabinetryBlurSave()}
                          className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-1 text-[11px] text-[#344054]"
                        >
                          <option value=""></option>
                          <option value="RH">RH</option>
                          <option value="LH">LH</option>
                        </select>
                      </div>
                    </div>
                  </section>

                  <section className="relative z-10 overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                    <div className="flex h-[50px] items-center border-b border-[#DCE3EC] bg-white px-4">
                      <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Hardware</p>
                    </div>
                    <div className="space-y-3 p-3 text-[12px]">
                      <div className="flex items-center gap-3">
                        {hardwareRows.map((row) => (
                          <label
                            key={row.name}
                            className="inline-flex items-center gap-1 font-semibold text-[#344054]"
                            title={hasDrawerRowsInUse ? "Locked while drawer rows exist in cutlist" : undefined}
                          >
                            <input
                              disabled={productionReadOnly || hasDrawerRowsInUse}
                              type="checkbox"
                              checked={productionForm.hardware.hardwareCategory === row.name}
                              onChange={() => void onHardwareCategoryChange(row.name)}
                            />
                            {row.name}
                          </label>
                        ))}
                      </div>
                      <div className="grid grid-cols-[92px_1fr] items-center gap-2">
                        <p className="font-semibold text-[#334155]">New Drawer Type</p>
                        <select
                          disabled={productionReadOnly || hasDrawerRowsInUse}
                          value={productionForm.hardware.newDrawerType}
                          onChange={(e) => void onChangeDrawerType(e.target.value)}
                          title={hasDrawerRowsInUse ? "Locked while drawer rows exist in cutlist" : undefined}
                          className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] text-[#344054]"
                        >
                          <option value=""></option>
                          {drawerOptionsForCategory(productionForm.hardware.hardwareCategory).map((row) => (
                            <option key={row.name} value={row.name}>{row.name}</option>
                          ))}
                        </select>
                      </div>
                      {hasDrawerRowsInUse && (
                        <p className="text-[11px] font-semibold text-[#B42318]">
                          Hardware and drawer type are locked while drawer rows exist in cutlist.
                        </p>
                      )}
                      <div className="grid grid-cols-[92px_1fr] items-center gap-2">
                        <p className="font-semibold text-[#334155]">Hinge Type</p>
                        <select
                          disabled
                          value={productionForm.hardware.hardwareCategory}
                          className="h-7 rounded-[8px] border border-[#D8DEE8] bg-[#F8FAFC] px-2 text-[12px] text-[#344054]"
                        >
                          <option value={productionForm.hardware.hardwareCategory}>{productionForm.hardware.hardwareCategory}</option>
                        </select>
                      </div>
                    </div>
                  </section>
                </div>

                <section className="relative z-10 overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                  <div className="flex h-[50px] items-center justify-between border-b border-[#DCE3EC] bg-white px-4">
                    <p className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Board Settings</p>
                    <button disabled={productionReadOnly} onClick={() => void onAddBoardRow()} className="text-[12px] font-bold text-[#7E9EBB] disabled:opacity-55">+ Add Board</button>
                  </div>
                  <div className="p-3 text-[12px]">
                    <div className="grid grid-cols-[28px_1fr_80px_80px_80px_50px_60px_110px_45px_70px] items-center gap-2 text-[11px] font-bold text-[#8A97A8]">
                      <p></p>
                      <p>Colour</p>
                      <p className="text-center">Thickness</p>
                      <p className="text-center">Finish</p>
                      <p className="text-center">Edging</p>
                      <p className="text-center">Grain</p>
                      <p className="text-center">Lacquer</p>
                      <p className="text-center">Sheet Size</p>
                      <p className="text-center">Sheets</p>
                      <p className="text-center">Edgetape</p>
                    </div>
                    <div className="mt-2 space-y-2">
                      {productionForm.boardTypes.map((row) => (
                        <div key={row.id} className="grid grid-cols-[28px_1fr_80px_80px_80px_50px_60px_110px_45px_70px] items-center gap-2">
                          {(() => {
                            const requiredSheets = requiredSheetCountByBoardRowId[row.id] ?? 0;
                            return (
                              <>
                          <button
                            disabled={productionReadOnly}
                            onClick={() => void onRemoveBoardRow(row.id)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828] disabled:opacity-55"
                          >
                            <X size={13} className="mx-auto" strokeWidth={2.8} />
                          </button>
                          <div className="relative">
                            <input
                              disabled={productionReadOnly}
                              value={row.colour}
                              onFocus={() => {
                                boardColourEditStartRef.current[row.id] = String(row.colour || "").trim();
                                setActiveBoardColourSuggestionsRowId(row.id);
                              }}
                              onChange={(e) => {
                                onBoardFieldDraftChange(row.id, { colour: e.target.value });
                                setActiveBoardColourSuggestionsRowId(row.id);
                              }}
                              onBlur={(e) => {
                              delete boardColourEditStartRef.current[row.id];
                              window.setTimeout(() => {
                                setActiveBoardColourSuggestionsRowId((prev) => (prev === row.id ? null : prev));
                              }, 120);
                              void onBoardFieldCommit(row.id, { colour: e.target.value }, true);
                            }}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  setActiveBoardColourSuggestionsRowId(null);
                                }
                              }}
                              className="h-7 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                            />
                            {activeBoardColourSuggestionsRowId === row.id &&
                              (() => {
                                const query = String(row.colour || "").trim().toLowerCase();
                                const starts = boardColourSuggestions.filter((c) => c.toLowerCase().startsWith(query));
                                const contains = boardColourSuggestions.filter(
                                  (c) => !c.toLowerCase().startsWith(query) && c.toLowerCase().includes(query),
                                );
                                const filtered = (query ? [...starts, ...contains] : boardColourSuggestions).slice(0, 20);
                                if (!filtered.length) return null;
                                return (
                                  <div className="absolute left-0 top-[calc(100%+2px)] z-30 max-h-[220px] w-[220px] overflow-auto rounded-[8px] border border-[#D6DEE9] bg-white p-1 shadow-[0_12px_28px_rgba(15,23,42,0.14)]">
                                    {filtered.map((colour) => (
                                      <button
                                        key={`${row.id}_${colour}`}
                                        type="button"
                                        onMouseDown={(ev) => ev.preventDefault()}
                                        onClick={() => {
                                          delete boardColourEditStartRef.current[row.id];
                                          setActiveBoardColourSuggestionsRowId(null);
                                          void onBoardFieldCommit(row.id, { colour }, true);
                                        }}
                                        className="block w-full rounded-[6px] px-2 py-1 text-left text-[12px] font-semibold text-[#334155] hover:bg-[#EEF2F7]"
                                      >
                                        {colour}
                                      </button>
                                    ))}
                                  </div>
                                );
                              })()}
                          </div>
                          <select
                            disabled={productionReadOnly}
                            value={row.thickness}
                            onChange={(e) => void onBoardFieldCommit(row.id, { thickness: e.target.value })}
                            className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                          >
                            <option value=""></option>
                            {boardThicknessOptions.map((opt) => (
                              <option key={opt} value={opt}>{opt} mm</option>
                            ))}
                          </select>
                          <select
                            disabled={productionReadOnly}
                            value={row.finish}
                            onChange={(e) => void onBoardFieldCommit(row.id, { finish: e.target.value })}
                            className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                          >
                            <option value=""></option>
                            {boardFinishOptions.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          <input
                            disabled={productionReadOnly}
                            value={row.edging}
                            onChange={(e) => onBoardFieldDraftChange(row.id, { edging: e.target.value })}
                            onBlur={(e) => void onBoardFieldCommit(row.id, { edging: e.target.value || "Matching" })}
                            className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                          />
                          <input
                            disabled={productionReadOnly}
                            type="checkbox"
                            checked={row.grain}
                            onChange={(e) => void onBoardFieldCommit(row.id, { grain: e.target.checked })}
                          />
                          <input
                            disabled={productionReadOnly}
                            type="checkbox"
                            checked={row.lacquer}
                            onChange={(e) => void onBoardFieldCommit(row.id, { lacquer: e.target.checked })}
                          />
                          <select
                            disabled={productionReadOnly}
                            value={row.sheetSize}
                            onChange={(e) => void onBoardFieldCommit(row.id, { sheetSize: e.target.value })}
                            className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                          >
                            <option value=""></option>
                            {sheetSizeOptions.map((opt) => {
                              const label = `${opt.h} x ${opt.w}`;
                              return <option key={label} value={label}>{label}</option>;
                            })}
                          </select>
                          <p className="text-center text-[12px] font-semibold text-[#344054]">{requiredSheets}</p>
                          <p className="text-center text-[12px] font-semibold text-[#344054]">
                            {requiredEdgetapeByBoardRowId[row.id] ?? row.edgetape}
                          </p>
                              </>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                    <button disabled={productionReadOnly} onClick={() => void onAddBoardRow()} className="mt-3 text-[12px] font-bold text-[#7E9EBB] disabled:opacity-55">+ Add Board</button>
                  </div>
                </section>
                  </>
                )}
              </div>
            </div>
          )}

          {resolvedTab === "settings" && settingsAccess.view && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader className="border-b border-[#D7DEE8] pb-2">
                  <CardTitle className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Project Assignment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-3 text-[12px]">
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3">
                    <p className="font-semibold text-[#334155]">Project Creator</p>
                    <select
                      value={String(project.createdByUid ?? "").trim()}
                      onChange={(e) => void onChangeProjectCreatorUser(e.target.value)}
                      disabled={!isCurrentProjectCreator || isSavingGeneralDetails}
                      className="h-9 min-w-0 rounded-[8px] border border-[#D8DEE8] bg-white px-3 text-[12px] text-[#334155] outline-none disabled:bg-[#F8FAFC] disabled:text-[#98A2B3]"
                    >
                      {companyMembers.map((member) => (
                        <option key={member.uid} value={member.uid}>
                          {member.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3">
                    <p className="font-semibold text-[#334155]">Assigned User</p>
                    <select
                      value={String(project.assignedToUid ?? "").trim()}
                      onChange={(e) => void onChangeAssignedProjectUser(e.target.value)}
                      disabled={!settingsAccess.edit || isSavingGeneralDetails}
                      className="h-9 min-w-0 rounded-[8px] border border-[#D8DEE8] bg-white px-3 text-[12px] text-[#334155] outline-none disabled:bg-[#F8FAFC] disabled:text-[#98A2B3]"
                    >
                      <option value="">Unassigned</option>
                      {companyMembers.map((member) => (
                        <option key={member.uid} value={member.uid}>
                          {member.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-[11px] font-medium text-[#8A97A8]">
                    Only the current project creator can hand creator ownership to another staff member.
                  </p>
                  <p className="text-[11px] font-medium text-[#8A97A8]">
                    The assigned user becomes the project manager and receives edit access to this project.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b border-[#D7DEE8] pb-2">
                  <CardTitle className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Project Permissions</CardTitle>
                </CardHeader>
                <CardContent className="pt-1 text-[12px]">
                  {permissionRows.map((row) => (
                    <div key={row.uid} className="grid grid-cols-[1fr_120px_120px] items-center gap-2 border-b border-[#DCE3EC] py-[8px]">
                      <p className="font-semibold text-[#334155]">{row.displayName}</p>
                      <select className="h-7 rounded-[8px] border border-[#D8DEE8] bg-[#F8FAFC] px-2 text-[12px] font-semibold text-[#475467]">
                        <option>{row.accessLabel}</option>
                        <option>View</option>
                        <option>No Access</option>
                      </select>
                      <button className="rounded-[8px] border border-[#C8DAFF] bg-[#EAF0FF] px-2 py-1 text-[11px] font-bold text-[#2358A9]">
                        Temp Prod Edit
                      </button>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b border-[#D7DEE8] pb-2">
                  <CardTitle className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Changelog</CardTitle>
                </CardHeader>
                <CardContent className="h-[560px] space-y-2 overflow-auto pt-2 text-[12px]">
                  {changes.length === 0 && <p className="text-[#6B7280]">No changes recorded.</p>}
                  {changes.map((change) => (
                    <div key={change.id} className="rounded-[10px] border border-[#DEE4EC] bg-[#F5F6F8] p-3">
                      <p className="font-bold text-[#1E3A62]">{change.action}</p>
                      <p className="text-[#2F4563]">{change.actor}</p>
                      <p className="text-[#5B6472]">{shortDate(change.at)}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {openProjectFilePreview && (
            <div className="fixed inset-0 z-[1600] flex items-center justify-center px-4 py-4">
              <button
                type="button"
                aria-label="Close file preview backdrop"
                onClick={() => setOpenProjectFilePreviewId("")}
                className="absolute inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-[2px]"
              />
              <div className="relative z-[1601] flex h-[min(88vh,760px)] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-[14px] border border-[#D6DEE9] bg-white shadow-[0_28px_70px_rgba(2,6,23,0.28)]">
                <div className="flex items-center justify-between border-b border-[#D7DEE8] px-4 py-3">
                  <p className="truncate pr-4 text-[13px] font-bold text-[#1F2937]">{openProjectFilePreview.name}</p>
                  <button
                    type="button"
                    onClick={() => setOpenProjectFilePreviewId("")}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#D8DEE8] text-[#64748B] hover:bg-[#F8FAFC]"
                    aria-label="Close file preview"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 bg-white">
                  {openProjectFilePreview.url || openProjectFilePreview.path ? (
                    <iframe
                      src={openProjectFilePreview.url || openProjectFilePreview.path}
                      title={openProjectFilePreview.name}
                      className="h-full w-full bg-white"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[13px] font-semibold text-[#667085]">
                      Preview unavailable.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {salesRoomDeleteBlocked && (
            <div className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
              <button
                type="button"
                aria-label="Close room delete warning backdrop"
                onClick={() => setSalesRoomDeleteBlocked(null)}
                className="absolute inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-[2px]"
              />
              <div className="relative z-[1701] w-[min(720px,96vw)] overflow-hidden rounded-[14px] border border-[#D6DEE9] bg-white shadow-[0_28px_70px_rgba(2,6,23,0.28)]">
                <div className="border-b border-[#D7DEE8] px-5 py-4">
                  <p className="text-[14px] font-bold text-[#1F2937]">
                    {salesRoomDeleteBlocked.roomName} contains a value, it cannot be deleted.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-4">
                  <button
                    type="button"
                    disabled={salesReadOnly || isSavingSalesRooms}
                    onClick={async () => {
                      const roomName = salesRoomDeleteBlocked.roomName;
                      await onToggleSalesRoomIncluded(roomName, false);
                      setSalesRoomDeleteBlocked(null);
                    }}
                    className="h-9 rounded-[9px] border border-[#C8DAFF] bg-[#EAF1FF] px-4 text-[12px] font-bold text-[#24589A] disabled:opacity-55"
                  >
                    Exclude from quote
                  </button>
                  <button
                    type="button"
                    onClick={() => setSalesRoomDeleteBlocked(null)}
                    className="h-9 rounded-[9px] border border-[#D8DEE8] bg-white px-4 text-[12px] font-bold text-[#334155]"
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          )}
          {isAddRoomModalOpen && typeof document !== "undefined" && createPortal(
            <div className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
              <button
                type="button"
                aria-label="Close add room dialog backdrop"
                onClick={() => {
                  setIsAddRoomModalOpen(false);
                  setAddRoomName("");
                }}
                className="absolute inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-[2px]"
              />
              <div className="relative z-[1701] w-[min(720px,96vw)] overflow-hidden rounded-[14px] border border-[#D6DEE9] bg-white shadow-[0_28px_70px_rgba(2,6,23,0.28)]">
                <div className="border-b border-[#D7DEE8] px-5 py-4">
                  <p className="text-[14px] font-bold uppercase tracking-[1px] text-[#12345B]">Add Room</p>
                </div>
                <div className="space-y-4 px-5 py-4">
                  <div className="space-y-2">
                    <p className="text-[12px] font-semibold text-[#475467]">Room Name</p>
                    <input
                      autoFocus
                      value={addRoomName}
                      onChange={(e) => setAddRoomName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void onConfirmAddCutlistRoom();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setIsAddRoomModalOpen(false);
                          setAddRoomName("");
                        }
                      }}
                      placeholder="Enter room name"
                      className="h-10 w-full rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFC] px-3 text-[13px] text-[#111827] outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddRoomModalOpen(false);
                        setAddRoomName("");
                      }}
                      className="h-9 rounded-[9px] border border-[#D8DEE8] bg-white px-4 text-[12px] font-bold text-[#334155]"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={isSavingSalesRooms}
                      onClick={() => void onConfirmAddCutlistRoom()}
                      className="h-9 rounded-[9px] border border-[#BFE8CF] bg-[#DDF2E7] px-4 text-[12px] font-bold text-[#1F6A3B] disabled:opacity-55"
                    >
                      Add Room
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}






















