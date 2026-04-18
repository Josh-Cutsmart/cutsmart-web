"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown, ClipboardList, Cpu, GitBranch, ListChecks, Lock, Minus, Plus, Quote, Ruler, Scissors, ShoppingCart, Tag, X } from "lucide-react";
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
  saveCompanyDocPatch,
  softDeleteProject,
  updateProjectPatch,
  updateProjectStatus,
  updateProjectTags,
} from "@/lib/firestore-data";
import type { CompanyMemberOption } from "@/lib/firestore-data";
import { getProductionUnlockRemainingSeconds, projectTabAccess } from "@/lib/permissions";
import { fetchCompanyAccess, type CompanyAccessInfo } from "@/lib/membership";
import type { Cutlist, Project, ProjectChange, SalesQuote } from "@/lib/types";
import { storage } from "@/lib/firebase";

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";

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
type HardwareTypeRow = { name: string; isDefault: boolean; drawers: HardwareDrawerType[] };
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

type ProductionNav = "overview" | "cutlist" | "nesting" | "cnc" | "order" | "unlock";
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
type SalesRoomRow = { name: string; included: boolean; totalPrice: string };
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
  message: string;
  action?: string;
  actionKind?: "clear" | "undo" | "";
  dedupeKey?: string;
  partType?: string;
  partTypeTo?: string;
  valueFrom?: string;
  valueTo?: string;
};

type CutlistValidationIssue = {
  field: "partType" | "board" | "name" | "height" | "width" | "depth" | "quantity";
  message: string;
};

function toStr(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
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
      return {
        name,
        isDefault: Boolean(item.default),
        drawers: normalizeDrawerTypes(item.drawers),
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
      className="inline-block [transform:rotate(270deg)]"
      style={{
        width: 10,
        height: 10,
        backgroundColor: color || "#0F172A",
        WebkitMaskImage: "url('/Arrow.png')",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        WebkitMaskSize: "contain",
        maskImage: "url('/Arrow.png')",
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
    <div ref={hostRef} className="relative min-w-0 overflow-visible">
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
        <span ref={labelRef} className="truncate">{summaryValue || value || ""}</span>
        <ChevronDown size={compact ? 13 : 14} />
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
          <ChevronDown size={compact ? 13 : 14} />
        </div>
      )}
      {open && !disabled && (
        <div className="absolute left-0 top-[calc(100%+2px)] z-40 min-w-[220px] rounded-[8px] border border-[#D9DEE8] bg-white p-1 shadow-[0_10px_30px_rgba(15,23,42,0.12)]">
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
  options: string[];
  disabled?: boolean;
  bg: string;
  border: string;
  text: string;
  className?: string;
  title?: string;
  getSize: (value: string) => string;
  getLabel: (value: string) => string;
  onChange: (value: string) => void;
};

function BoardPillDropdown({
  value,
  options,
  disabled,
  bg,
  border,
  text,
  className,
  title,
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

  return (
    <div ref={hostRef} className="relative z-[60] pointer-events-auto">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        title={title}
        onClick={() => setOpen((v) => !v)}
        className={`pointer-events-auto h-8 w-full rounded-[8px] border px-2 text-left text-[12px] disabled:opacity-70 ${className ?? ""}`}
        style={{ backgroundColor: bg, borderColor: border, color: text }}
      >
        <span className="inline-flex w-full items-center justify-between gap-2">
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
          <ChevronDown size={14} />
        </span>
      </button>
      {open && rect && !disabled && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 pointer-events-auto" style={{ zIndex: 2147483647 }}>
          <div
            ref={menuRef}
            className="pointer-events-auto fixed max-h-[280px] overflow-auto rounded-[8px] border border-[#D9DEE8] bg-white p-1 shadow-[0_10px_30px_rgba(15,23,42,0.12)]"
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
              className="flex h-8 w-full items-center rounded-[6px] px-2 text-left text-[12px] text-[#64748B] hover:bg-[#F8FAFC]"
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
                  className="flex h-8 w-full items-center rounded-[6px] px-2 text-left text-[12px] text-[#0F172A] hover:bg-[#F8FAFC]"
                >
                  <span className="inline-flex min-w-0 items-center gap-2">
                  {!!sz && (
                    <span className="inline-flex h-5 min-w-[28px] items-center justify-center rounded-[999px] bg-[#B6C3D4] px-2 text-[10px] font-bold text-[#0F172A]">
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
  const [isSavingSalesRooms, setIsSavingSalesRooms] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [lockMessage, setLockMessage] = useState("");
  const [unlockHours, setUnlockHours] = useState<number>(6);
  const [unlockTick, setUnlockTick] = useState(0);
  const [isGrantingUnlock, setIsGrantingUnlock] = useState(false);
  const [unlockMembers, setUnlockMembers] = useState<CompanyMemberOption[]>([]);
  const [unlockTargetUid, setUnlockTargetUid] = useState("");
  const [companyAccess, setCompanyAccess] = useState<CompanyAccessInfo | null>(null);
  const [companyDoc, setCompanyDoc] = useState<Record<string, unknown> | null>(null);
  const [productionNav, setProductionNav] = useState<ProductionNav>("overview");
  const [nestingFullscreen, setNestingFullscreen] = useState(false);
  const boardColourEditStartRef = useRef<Record<string, string>>({});
  const [productionCutlist, setProductionCutlist] = useState<Cutlist | null>(null);
  const [cutlistRows, setCutlistRows] = useState<CutlistRow[]>([]);
  const [cutlistSearch, setCutlistSearch] = useState("");
  const [cutlistPartTypeFilter, setCutlistPartTypeFilter] = useState("All Part Types");
  const [cutlistRoomFilter, setCutlistRoomFilter] = useState("Project Cutlist");
  const [cncSearch, setCncSearch] = useState("");
  const [cncPartTypeFilter, setCncPartTypeFilter] = useState("All Part Types");
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
  const [cutlistEntry, setCutlistEntry] = useState<Omit<CutlistRow, "id" | "room">>({
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
  const [activeCutlistPartType, setActiveCutlistPartType] = useState("");
  const [cutlistDraftRows, setCutlistDraftRows] = useState<CutlistDraftRow[]>([]);
  const [cutlistDraftInitialized, setCutlistDraftInitialized] = useState(false);
  const [cutlistCellWarnings, setCutlistCellWarnings] = useState<Record<string, Record<string, string>>>({});
  const [cutlistFlashingCells, setCutlistFlashingCells] = useState<Record<string, boolean>>({});
  const [cutlistActivityFeed, setCutlistActivityFeed] = useState<CutlistActivityEntry[]>([]);
  const [cutlistFlashPhaseOn, setCutlistFlashPhaseOn] = useState(false);
  const cutlistFlashTimeoutRef = useRef<number | null>(null);
  const cutlistFlashIntervalRef = useRef<number | null>(null);
  const cutlistActivityScrollRef = useRef<HTMLDivElement | null>(null);
  const cutlistActivityInnerRef = useRef<HTMLDivElement | null>(null);
  const cutlistActivityNextIdRef = useRef<number>(1);
  const cutlistActivityDraggingRef = useRef(false);
  const cutlistActivityActivePointerIdRef = useRef<number | null>(null);
  const cutlistActivityDragStartXRef = useRef(0);
  const cutlistActivityDragStartOffsetRef = useRef(0);
  const [cutlistActivityOffset, setCutlistActivityOffset] = useState(0);
  const cutlistActivityOffsetRef = useRef(0);
  const cutlistActivityMinOffsetRef = useRef(0);
  const cutlistActivityMaxOffsetRef = useRef(0);
  const [collapsedCutlistGroups, setCollapsedCutlistGroups] = useState<Record<string, boolean>>({});
  const [editingCell, setEditingCell] = useState<{ rowId: string; key: CutlistEditableField } | null>(null);
  const [editingCellValue, setEditingCellValue] = useState("");
  const [editingClashLeft, setEditingClashLeft] = useState("");
  const [editingClashRight, setEditingClashRight] = useState("");
  const [editingFixedShelf, setEditingFixedShelf] = useState("");
  const [editingAdjustableShelf, setEditingAdjustableShelf] = useState("");
  const [editingFixedShelfDrilling, setEditingFixedShelfDrilling] = useState<"No" | "Even Spacing" | "Centre">("No");
  const [editingAdjustableShelfDrilling, setEditingAdjustableShelfDrilling] = useState<"No" | "Even Spacing" | "Centre">("No");
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
  const salesRoomRows = useMemo(
    () => normalizeSalesRooms((salesPayload as Record<string, unknown>).rooms),
    [salesPayload],
  );
  const salesRoomNames = useMemo(() => salesRoomRows.map((row) => row.name), [salesRoomRows]);
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
  const grainDimensionOptions = (height: string, width: string, depth: string) => {
    const values = [height, width, depth]
      .map((v) => String(v ?? "").trim())
      .filter(Boolean);
    return Array.from(new Set(values));
  };
  const matchesGrainDimension = (grainValue: string, dimensionValue: string) => {
    const g = String(grainValue ?? "").trim();
    const d = String(dimensionValue ?? "").trim();
    if (!g || !d) return false;
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

  const partTypeOptions = useMemo(() => {
    const raw = Array.isArray(companyDoc?.partTypes) ? companyDoc?.partTypes : [];
    const parsed = raw
      .filter((row) => row && typeof row === "object")
      .map((row) => toStr((row as Record<string, unknown>).name))
      .filter(Boolean);
    return parsed.length ? parsed : ["Cabinet", "Drawer", "Panel", "Front"];
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
    setCutlistActivityFeed((prev) => {
      const key = String(opts?.dedupeKey || "").trim();
      let next = [...prev];
      if (key) next = next.filter((item) => String(item.dedupeKey || "") !== key);
      next.push({
        id: cutlistActivityNextIdRef.current++,
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
  };
  const removeCutlistActivity = (id: number) => {
    setCutlistActivityFeed((prev) => prev.filter((entry) => entry.id !== id));
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
    return key;
  };
  const cutlistValueForActivity = (row: CutlistRow, key: CutlistEditableField) => {
    if (key === "board") return boardDisplayLabel(String(row.board || "").trim());
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
      setCutlistActivityOffsetClamped(target);
      ev.preventDefault();
    };
    const onPointerUpWindow = (ev: PointerEvent) => {
      if (!cutlistActivityDraggingRef.current) return;
      if (cutlistActivityActivePointerIdRef.current !== null && ev.pointerId !== cutlistActivityActivePointerIdRef.current) return;
      cutlistActivityDraggingRef.current = false;
      const node = cutlistActivityScrollRef.current;
      if (node) {
        node.style.cursor = "grab";
        try {
          node.releasePointerCapture(ev.pointerId);
        } catch {}
      }
      cutlistActivityActivePointerIdRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onPointerMoveWindow, { passive: false });
    window.addEventListener("pointerup", onPointerUpWindow);
    window.addEventListener("pointercancel", onPointerUpWindow);
    return () => {
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
  useEffect(() => {
    const isFullscreen = resolvedTab === "production" && productionAccess.view && productionNav === "cutlist";
    if (!isFullscreen) return;
    ensureCutlistActivityLatestVisible();
  }, [cutlistActivityFeed, resolvedTab, productionAccess.view, productionNav]);
  useEffect(() => {
    const isFullscreen = resolvedTab === "production" && productionAccess.view && productionNav === "cutlist";
    if (!isFullscreen) return;
    const onResize = () => {
      recalcCutlistActivityBounds(false);
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [resolvedTab, productionAccess.view, productionNav]);
  const activeCutlistEntryColor = partTypeColors[cutlistEntry.partType] ?? "#CBD5E1";
  const activeCutlistEntryTextColor = isLightHex(activeCutlistEntryColor) ? "#1F2937" : "#F8FAFC";
  const activeCutlistEntryFieldBg = lightenHex(activeCutlistEntryColor, 0.12);
  const activeCutlistEntryFieldBorder = darkenHex(activeCutlistEntryColor, 0.2);

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

  const defaultCutlistRoom = useMemo(
    () => cutlistEntryRoomOptions[0] ?? "Project Cutlist",
    [cutlistEntryRoomOptions],
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
        width: "",
        depth: formatMm(depthMinusT),
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
      boardTypes: boardRows.length ? boardRows : [newBoardRow()],
    });
  }, [project?.id, boardThicknessOptions, boardFinishOptions, sheetSizeOptions, hardwareRows]);

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
      setCutlistActivityFeed([]);
      cutlistActivityNextIdRef.current = 1;
      return;
    }
    try {
      const raw = window.localStorage.getItem(cutlistUiStateStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          cutlistRoomFilter?: string;
          cutlistPartTypeFilter?: string;
          cutlistSearch?: string;
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
        if (Array.isArray(parsed.cutlistActivityFeed)) {
          const restored = parsed.cutlistActivityFeed
            .filter((entry) => entry && typeof entry === "object")
            .map((entry) => {
              const actionKindRaw = String((entry as CutlistActivityEntry).actionKind || "").trim().toLowerCase();
              const actionKind: "" | "clear" | "undo" =
                actionKindRaw === "clear" || actionKindRaw === "undo" ? actionKindRaw : "";
              return {
                id: Number((entry as CutlistActivityEntry).id || 0),
                message: String((entry as CutlistActivityEntry).message || "").trim(),
                action: String((entry as CutlistActivityEntry).action || "").trim(),
                actionKind,
                dedupeKey: String((entry as CutlistActivityEntry).dedupeKey || "").trim(),
                partType: String((entry as CutlistActivityEntry).partType || "").trim(),
                partTypeTo: String((entry as CutlistActivityEntry).partTypeTo || "").trim(),
                valueFrom: String((entry as CutlistActivityEntry).valueFrom || "").trim(),
                valueTo: String((entry as CutlistActivityEntry).valueTo || "").trim(),
              };
            })
            .filter((entry) => entry.message)
            .slice(-120);
          setCutlistActivityFeed(restored);
          const maxId = restored.reduce((m, e) => Math.max(m, Number(e.id || 0)), 0);
          cutlistActivityNextIdRef.current = maxId + 1;
        }
      } else {
        setCutlistActivityFeed([]);
        cutlistActivityNextIdRef.current = 1;
      }
    } catch {
      // Ignore invalid local state and continue with defaults.
      setCutlistActivityFeed([]);
      cutlistActivityNextIdRef.current = 1;
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
      nestingSearch,
      nestingVisibilityMap,
      nestingCollapsedGroups,
      collapsedCutlistGroups,
      expandedCabinetryRows,
      expandedDrawerRows,
      cutlistActivityFeed: cutlistActivityFeed.slice(-120),
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
    nestingSearch,
    nestingVisibilityMap,
    nestingCollapsedGroups,
    collapsedCutlistGroups,
    expandedCabinetryRows,
    expandedDrawerRows,
    cutlistActivityFeed,
  ]);

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
      if (project.companyId) {
        const refreshed = await fetchCompanyDoc(project.companyId);
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
    const input = window.prompt("Room name");
    const next = String(input || "").trim();
    if (!next) return;
    const exists = salesRoomRows.some((row) => row.name.toLowerCase() === next.toLowerCase());
    if (exists) {
      setCutlistRoomFilter(next);
      setCutlistEntryRoom(next);
      return;
    }
    const nextSales = {
      ...salesPayload,
      rooms: [...salesRoomRows, { name: next, included: true, totalPrice: "0.00" }],
    } as Record<string, unknown>;
    setIsSavingSalesRooms(true);
    const ok = await updateProjectPatch(project, {
      sales: nextSales,
      salesJson: JSON.stringify(nextSales),
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
    setCutlistRoomFilter(next);
    setCutlistEntryRoom(next);
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
      boardTypes: nextRows.length ? nextRows : [newBoardRow()],
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

  const onBoardFieldCommit = async (id: string, patch: Partial<ProductionBoardRow>, bumpColour = false, previousColourRaw?: string) => {
    const prevRows = productionForm.boardTypes;
    const next = {
      ...productionForm,
      boardTypes: productionForm.boardTypes.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    };
    setProductionForm(next);
    const ok = await persistProductionForm(next);
    if (ok && bumpColour) {
      const fallbackOld = String(prevRows.find((row) => row.id === id)?.colour ?? "").trim();
      const oldColour = String(previousColourRaw ?? fallbackOld).trim();
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
    const rows = nextRows.map((row, idx) => {
      const isCabinetry = isCabinetryPartType(row.partType);
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
    await updateProjectPatch(project, { cutlist: { rows } });
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
      setCutlistDraftRows(rejectedRows.length ? rejectedRows : [createDraftCutlistRow(activeCutlistPartType || accepted[0].partType, cutlistEntryRoom || defaultCutlistRoom, { board: accepted[accepted.length - 1].board || cutlistBoardOptions[0] || "" })]);
    } else {
      setCutlistDraftRows([createDraftCutlistRow(activeCutlistPartType || accepted[0].partType, cutlistEntryRoom || defaultCutlistRoom, { board: accepted[accepted.length - 1].board || cutlistBoardOptions[0] || "" })]);
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

  const visibleCutlistRows = useMemo(() => {
    const search = cutlistSearch.trim().toLowerCase();
    return cutlistRows.filter((row) => {
      const roomOk = cutlistRoomFilter === "Project Cutlist" ? true : row.room === cutlistRoomFilter;
      const typeOk = cutlistPartTypeFilter === "All Part Types" || row.partType === cutlistPartTypeFilter;
      const searchOk =
        !search ||
        [row.name, row.board, row.partType, row.information].some((v) => String(v || "").toLowerCase().includes(search));
      return roomOk && typeOk && searchOk;
    });
  }, [cutlistRows, cutlistPartTypeFilter, cutlistSearch, cutlistRoomFilter]);

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

  const singleEntryShowsShelvesHeader = useMemo(
    () => isCabinetryPartType(cutlistEntry.partType),
    [cutlistEntry.partType],
  );
  const singleEntryHeightGrainMatch = useMemo(
    () => matchesGrainDimension(String(cutlistEntry.grainValue ?? ""), cutlistEntry.height),
    [cutlistEntry.grainValue, cutlistEntry.height],
  );
  const singleEntryWidthGrainMatch = useMemo(
    () => matchesGrainDimension(String(cutlistEntry.grainValue ?? ""), cutlistEntry.width),
    [cutlistEntry.grainValue, cutlistEntry.width],
  );
  const singleEntryDepthGrainMatch = useMemo(
    () => matchesGrainDimension(String(cutlistEntry.grainValue ?? ""), cutlistEntry.depth),
    [cutlistEntry.grainValue, cutlistEntry.depth],
  );

  useEffect(() => {
    if (!isDrawerPartType(cutlistEntry.partType)) return;
    const qty = String(Math.max(1, parseDrawerHeightTokens(String(cutlistEntry.height ?? "")).length));
    if (cutlistEntry.quantity === qty) return;
    setCutlistEntry((prev) => ({ ...prev, quantity: qty }));
  }, [cutlistEntry.height, cutlistEntry.partType, cutlistEntry.quantity, isDrawerPartType]);

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

  const cncSourceRows = useMemo(() => {
    return cutlistRows.filter((row) => isPartTypeIncludedInCnc(row.partType));
  }, [cutlistRows, isPartTypeIncludedInCnc]);

  const cncExpandedRows = useMemo(() => {
    const out: Array<CutlistRow & { sourceRowId: string }> = [];
    for (const row of cncSourceRows) {
      const visible = typeof cncVisibilityMap[row.id] === "boolean" ? cncVisibilityMap[row.id] : true;
      if (!visible) continue;

      if (isCabinetryPartType(row.partType)) {
        const pieces = buildCabinetryDerivedPieces(row);
        for (const piece of pieces) {
          const qty = Math.max(0, Number.parseInt(String(piece.quantity || "0"), 10) || 0);
          if (qty <= 0) continue;
          out.push({
            ...row,
            id: `${row.id}__cab__${piece.key}`,
            sourceRowId: row.id,
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
          out.push({
            ...row,
            id: `${row.id}__drw__${piece.key}`,
            sourceRowId: row.id,
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
    const map = new Map<string, { boardKey: string; boardLabel: string; rows: (CutlistRow & { sourceRowId: string })[] }>();
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
          const ar = rank.has(a.partType) ? Number(rank.get(a.partType)) : 999;
          const br = rank.has(b.partType) ? Number(rank.get(b.partType)) : 999;
          return (
            ar - br ||
            pieceKindRank(a.name) - pieceKindRank(b.name) ||
            String(a.name || "").localeCompare(String(b.name || "")) ||
            String(a.id).localeCompare(String(b.id))
          );
        }),
      }));
  }, [filteredCncRows, partTypeOptions, boardDisplayLabel]);

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
    for (const row of cutlistRows) {
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
    cutlistRows,
    isCabinetryPartType,
    isDrawerPartType,
    isPartTypeIncludedInNesting,
    nestingSearch,
    nestingVisibilityMap,
  ]);

  const nestingRowsForSheetCount = useMemo(() => {
    const expanded: CutlistRow[] = [];
    for (const row of cutlistRows) {
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
    cutlistRows,
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
    const filtered = cutlistRows.filter((row) => {
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
  }, [boardDisplayLabel, cutlistRows, isPartTypeIncludedInNesting, nestingSearch]);

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

  const cutlistColumnDefs = useMemo(
    () =>
      cutlistColumns
      .map((label) => {
        const key = label.toLowerCase().replace(/\s+/g, "");
        if (key.includes("parttype")) return { label, key: "partType" as const };
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
  const showRoomColumnInList = cutlistRoomFilter === "Project Cutlist";
  const cutlistListColumnDefs = useMemo(() => {
    if (showRoomColumnInList) return cutlistColumnDefs;
    const hasPartType = cutlistColumnDefs.some((col) => col.key === "partType");
    if (hasPartType) return cutlistColumnDefs;
    return [{ label: "Part", key: "partType" as const }, ...cutlistColumnDefs];
  }, [cutlistColumnDefs, showRoomColumnInList]);
  const cutlistEntryColumnDefs = useMemo(
    () => cutlistColumnDefs.filter((col) => col.key !== "partType"),
    [cutlistColumnDefs],
  );
  const cutlistEntryOrderMap = useMemo(() => {
    const map = new Map<CutlistEditableField, number>();
    cutlistEntryColumnDefs.forEach((col, idx) => map.set(col.key, idx + 1));
    return map;
  }, [cutlistEntryColumnDefs]);
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
        cols.push("60px");
      }
    });
    return cols.join(" ");
  }, [cutlistEntryColumnDefs]);
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
        return { width: 116, minWidth: 116 };
      case "board":
        return { width: 230, minWidth: 230 };
      case "name":
        return { width: 230, minWidth: 230 };
      case "height":
      case "width":
      case "depth":
      case "quantity":
        return { width: 70, minWidth: 70 };
      case "clashing":
        return { width: 168, minWidth: 168 };
      case "grain":
        return { width: 60, minWidth: 60 };
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
        setEditingFixedShelf(String(row.fixedShelf ?? ""));
        setEditingAdjustableShelf(String(row.adjustableShelf ?? ""));
        setEditingFixedShelfDrilling(normalizeDrillingValue(row.fixedShelfDrilling));
        setEditingAdjustableShelfDrilling(normalizeDrillingValue(row.adjustableShelfDrilling));
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
    setEditingFixedShelf("");
    setEditingAdjustableShelf("");
    setEditingFixedShelfDrilling("No");
    setEditingAdjustableShelfDrilling("No");
    setEditingInfoFocusLine(null);
  };

  const commitCellEdit = async (overrideValue?: string) => {
    if (!editingCell) return;
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
    setEditingFixedShelf("");
    setEditingAdjustableShelf("");
    setEditingFixedShelfDrilling("No");
    setEditingAdjustableShelfDrilling("No");
    setEditingInfoFocusLine(null);
    await persistCutlistRows(next);
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

  const roomTags = salesRoomRows.length ? salesRoomRows.map((row) => row.name) : ["Main Room"];
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
  ].slice(0, 8);

  const isCutlistFullscreen = resolvedTab === "production" && productionAccess.view && productionNav === "cutlist";
  const isCncFullscreen = resolvedTab === "production" && productionAccess.view && productionNav === "cnc";
  const isNestingFullscreen =
    resolvedTab === "production" && productionAccess.view && productionNav === "nesting";
  const showCncGrainColumn =
    showCutlistGrainColumn || filteredCncRows.some((row) => String(row.grainValue ?? "").trim().length > 0);
  const cncTotalQty = filteredCncRows.reduce((sum, row) => sum + (Number.parseInt(String(row.quantity || "0"), 10) || 0), 0);
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

  if (isCutlistFullscreen) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-[var(--bg-app)]">
          <div className="flex h-[56px] items-center justify-between border-b border-[#D7DEE8] bg-white px-4 md:px-5">
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
          <div className="overflow-hidden border-b border-[#DCE3EC] bg-white px-3 py-1">
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
                style={{ userSelect: "none", touchAction: "none", transform: `translate3d(${cutlistActivityOffset}px, 0, 0)`, willChange: "transform" }}
                onPointerDown={onCutlistActivityPointerDown}
                onPointerUp={endCutlistActivityPointerDrag}
                onPointerCancel={endCutlistActivityPointerDrag}
              >
                {cutlistActivityFeed.map((entry, idx) => {
                  const colors = activityColorsForPart(entry.partType || "", entry.actionKind || "");
                  const isPartTypeMove = Boolean(entry.partType && entry.partTypeTo);
                  const isValueMove = Boolean(entry.valueFrom || entry.valueTo);
                  return (
                    <div
                      key={entry.id}
                      className="inline-flex items-center gap-[10px] rounded-[9px] border px-2 py-[2px]"
                      style={{
                        backgroundColor: colors.chipBg,
                        borderColor: colors.chipBorder,
                        marginRight: idx < cutlistActivityFeed.length - 1 ? 10 : 0,
                      }}
                    >
                      <span className="text-[11px] font-bold" style={{ color: colors.chipText, paddingRight: 5 }}>
                        {entry.message}
                      </span>
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
          <div className="grid min-h-[calc(100dvh-56px)] gap-0 xl:grid-cols-[190px_1fr]">
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

            <div className="flex min-h-full flex-col gap-4 p-4">
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
                      const draftBoardAllowsGrain = boardGrainFor(String(draft.board ?? "").trim());
                      const draftGrainValue = String(draft.grainValue ?? "").trim();
                      const draftHeightGrainMatch = matchesGrainDimension(draftGrainValue, draft.height);
                      const draftWidthGrainMatch = matchesGrainDimension(draftGrainValue, draft.width);
                      const draftDepthGrainMatch = matchesGrainDimension(draftGrainValue, draft.depth);
                      const boardWarn = warningForCell(draft.id, "board");
                      const nameWarn = warningForCell(draft.id, "name");
                      const heightWarn = warningForCell(draft.id, "height");
                      const widthWarn = warningForCell(draft.id, "width");
                      const depthWarn = warningForCell(draft.id, "depth");
                      const quantityWarn = warningForCell(draft.id, "quantity");
                      return (
                        <div
                          key={draft.id}
                          className="relative z-20 grid items-center gap-2 overflow-visible border-y px-1 py-1"
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
                          <input disabled={productionReadOnly} title={nameWarn || undefined} value={draft.name} onChange={(e) => updateDraftCutlistRow(draft.id, { name: e.target.value })} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] ${warningClassForCell(draft.id, "name")}`} style={{ ...warningStyleForCell(draft.id, "name", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }), ...cutlistEntryCellStyle("name") }} />
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
                            <input disabled={productionReadOnly} title={heightWarn || undefined} value={draft.height} onChange={(e) => updateDraftCutlistRow(draft.id, { height: e.target.value })} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center ${warningClassForCell(draft.id, "height")}`} style={{ ...warningStyleForCell(draft.id, "height", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }), ...(draftHeightGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : {}), ...cutlistEntryCellStyle("height") }} />
                          )}
                          <input disabled={productionReadOnly} title={widthWarn || undefined} value={draft.width} onChange={(e) => updateDraftCutlistRow(draft.id, { width: e.target.value })} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center ${warningClassForCell(draft.id, "width")}`} style={{ ...warningStyleForCell(draft.id, "width", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }), ...(draftWidthGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : {}), ...cutlistEntryCellStyle("width") }} />
                          <input disabled={productionReadOnly} title={depthWarn || undefined} value={draft.depth} onChange={(e) => updateDraftCutlistRow(draft.id, { depth: e.target.value })} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center ${warningClassForCell(draft.id, "depth")}`} style={{ ...warningStyleForCell(draft.id, "depth", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }), ...(draftDepthGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : {}), ...cutlistEntryCellStyle("depth") }} />
                          <input disabled={productionReadOnly || isDrawerPartType(draft.partType)} title={quantityWarn || undefined} value={draft.quantity} onChange={(e) => updateDraftCutlistRow(draft.id, { quantity: e.target.value })} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center disabled:opacity-90 ${warningClassForCell(draft.id, "quantity")}`} style={{ ...warningStyleForCell(draft.id, "quantity", { backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }), ...cutlistEntryCellStyle("quantity") }} />
                          {draftIsCabinetry ? (
                            <div className="grid gap-[1px]" style={cutlistEntryCellStyle("clashing", 2)}>
                              <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                <span className="text-[9px] font-bold leading-none" style={{ color: draftTextColor }}>Fixed Shelf</span>
                                <input
                                  disabled={productionReadOnly}
                                  value={draft.fixedShelf ?? ""}
                                  onChange={(e) => updateDraftCutlistRow(draft.id, { fixedShelf: e.target.value })}
                                  className="h-[18px] w-full min-w-0 rounded-[5px] border bg-transparent px-1 text-[9px]"
                                  style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }}
                                />
                              </div>
                              <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                <span className="inline-flex items-center gap-[2px] pl-[10px] text-[9px] font-bold leading-none" style={{ color: draftTextColor }}>
                                  <DrillingArrowIcon color={draftTextColor} />
                                  Drilling
                                </span>
                                <select
                                  disabled={productionReadOnly}
                                  value={normalizeDrillingValue(draft.fixedShelfDrilling)}
                                  onChange={(e) => updateDraftCutlistRow(draft.id, { fixedShelfDrilling: normalizeDrillingValue(e.target.value) })}
                                  className="h-[18px] w-full min-w-0 rounded-[5px] border bg-transparent px-1 text-[9px]"
                                  style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }}
                                >
                                  {DRILLING_OPTIONS.map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                <span className="text-[9px] font-bold leading-none" style={{ color: draftTextColor }}>Adjustable Shelf</span>
                                <input
                                  disabled={productionReadOnly}
                                  value={draft.adjustableShelf ?? ""}
                                  onChange={(e) => updateDraftCutlistRow(draft.id, { adjustableShelf: e.target.value })}
                                  className="h-[18px] w-full min-w-0 rounded-[5px] border bg-transparent px-1 text-[9px]"
                                  style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }}
                                />
                              </div>
                              <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                <span className="inline-flex items-center gap-[2px] pl-[10px] text-[9px] font-bold leading-none" style={{ color: draftTextColor }}>
                                  <DrillingArrowIcon color={draftTextColor} />
                                  Drilling
                                </span>
                                <select
                                  disabled={productionReadOnly}
                                  value={normalizeDrillingValue(draft.adjustableShelfDrilling)}
                                  onChange={(e) => updateDraftCutlistRow(draft.id, { adjustableShelfDrilling: normalizeDrillingValue(e.target.value) })}
                                  className="h-[18px] w-full min-w-0 rounded-[5px] border bg-transparent px-1 text-[9px]"
                                  style={{ backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }}
                                >
                                  {DRILLING_OPTIONS.map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          ) : (
                            <>
                              <select
                                disabled={productionReadOnly}
                                value={draft.clashLeft ?? ""}
                                onChange={(e) => updateDraftCutlistRow(draft.id, { clashLeft: e.target.value })}
                                className="h-8 rounded-[8px] border bg-transparent px-1 text-[12px] text-center"
                                style={{ ...cutlistEntrySubCellStyle("clashing", 0), backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }}
                              >
                                <option value=""></option>
                                {CLASH_LEFT_OPTIONS.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                              <select
                                disabled={productionReadOnly}
                                value={draft.clashRight ?? ""}
                                onChange={(e) => updateDraftCutlistRow(draft.id, { clashRight: e.target.value })}
                                className="h-8 rounded-[8px] border bg-transparent px-1 text-[12px] text-center"
                                style={{ ...cutlistEntrySubCellStyle("clashing", 1), backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }}
                              >
                                <option value=""></option>
                                {CLASH_RIGHT_OPTIONS.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
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
                              <select
                                disabled={productionReadOnly}
                                value={String(draft.grainValue ?? "")}
                                onChange={(e) =>
                                  updateDraftCutlistRow(draft.id, {
                                    grainValue: e.target.value,
                                    grain: Boolean(String(e.target.value).trim()),
                                  })
                                }
                                className="h-8 rounded-[8px] border bg-transparent px-1 text-[12px] text-center"
                                style={{ ...cutlistEntryCellStyle("grain"), backgroundColor: draftFieldBg, borderColor: draftFieldBorder, color: draftTextColor }}
                              >
                                <option value=""></option>
                                {grainDimensionOptions(draft.height, draft.width, draft.depth).map((opt) => (
                                  <option key={`${draft.id}_grain_${opt}`} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
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

              <section className="relative z-10 -mx-4 min-h-0 w-[calc(100%+2rem)] flex-1 overflow-hidden">
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
                <div className="flex h-full min-h-0 flex-col space-y-2 px-0 pb-0">
                  <div className="min-h-0 flex-1 overflow-auto bg-transparent">
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
                            </div>
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
                          {!collapsed && (
                          <table className="w-full text-left text-[12px]">
                            <thead style={{ backgroundColor: palette.headerBg, color: groupTextColor }}>
                              <tr>
                                <th className="w-[34px] px-2 py-2"></th>
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
                                  <td className="px-2 py-[3px] align-middle">
                                    <div className="flex items-center gap-1">
                                      <button
                                        disabled={productionReadOnly}
                                        onClick={() => void removeCutlistRow(row.id)}
                                        className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-[#F4B5B5] bg-[#FCEAEA] text-[#C62828] disabled:opacity-55"
                                      >
                                        <X size={11} strokeWidth={2.5} />
                                      </button>
                                      {(rowIsCabinetry || rowIsDrawer) && (
                                        <button
                                          type="button"
                                          onClick={() => (rowIsCabinetry ? toggleCabinetryRowExpand(row.id) : toggleDrawerRowExpand(row.id))}
                                          className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] border"
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
                                      )}
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
                                          className={`h-6 min-w-[130px] rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A] ${warningClassForCell(row.id, "room")}`}
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
                                              className="h-6 min-w-[130px] rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
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
                                              className="h-6 min-w-[170px] rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                            >
                                              <option value=""></option>
                                              {options.map((opt) => (
                                                <option key={opt} value={opt}>{boardOptionLabel(opt)}</option>
                                              ))}
                                            </select>
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
                                            <select
                                              autoFocus
                                              value={editingCellValue}
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                setEditingCellValue(v);
                                                void commitCellEdit(v);
                                              }}
                                              onBlur={() => void commitCellEdit()}
                                              className="h-6 min-w-[72px] rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                            >
                                              <option value=""></option>
                                              {grainDimensionOptions(row.height, row.width, row.depth).map((opt) => (
                                                <option key={`${row.id}_grain_edit_${opt}`} value={opt}>
                                                  {opt}
                                                </option>
                                              ))}
                                            </select>
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
                                                onChange={(e) => setEditingCellValue(e.target.value)}
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
                                            String(row.height ?? "")
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
                                              <div className="grid gap-[1px] text-left">
                                                <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                  <span className="text-[9px] font-bold leading-none">Fixed Shelf</span>
                                                  <input
                                                    autoFocus
                                                    value={editingFixedShelf}
                                                    onChange={(e) => setEditingFixedShelf(e.target.value)}
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        void commitCellEdit();
                                                      }
                                                      if (e.key === "Escape") cancelCellEdit();
                                                    }}
                                                    className="h-[18px] w-full min-w-0 rounded-[5px] border border-[#94A3B8] bg-white px-1 text-[9px] text-[#0F172A]"
                                                  />
                                                </div>
                                                <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                  <span className="inline-flex items-center gap-[2px] text-[9px] font-bold leading-none">
                                                    <DrillingArrowIcon color={groupTextColor} />
                                                    Drilling
                                                  </span>
                                                  <select
                                                    value={editingFixedShelfDrilling}
                                                    onChange={(e) => setEditingFixedShelfDrilling(normalizeDrillingValue(e.target.value))}
                                                    className="h-[18px] w-full min-w-0 rounded-[5px] border border-[#94A3B8] bg-white px-1 text-[9px] text-[#0F172A]"
                                                  >
                                                    {DRILLING_OPTIONS.map((opt) => (
                                                      <option key={opt} value={opt}>{opt}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                  <span className="text-[9px] font-bold leading-none">Adjustable Shelf</span>
                                                  <input
                                                    value={editingAdjustableShelf}
                                                    onChange={(e) => setEditingAdjustableShelf(e.target.value)}
                                                    onBlur={() => void commitCellEdit()}
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        void commitCellEdit();
                                                      }
                                                      if (e.key === "Escape") cancelCellEdit();
                                                    }}
                                                    className="h-[18px] w-full min-w-0 rounded-[5px] border border-[#94A3B8] bg-white px-1 text-[9px] text-[#0F172A]"
                                                  />
                                                </div>
                                                <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                  <span className="inline-flex items-center gap-[2px] text-[9px] font-bold leading-none">
                                                    <DrillingArrowIcon color={groupTextColor} />
                                                    Drilling
                                                  </span>
                                                  <select
                                                    value={editingAdjustableShelfDrilling}
                                                    onChange={(e) => setEditingAdjustableShelfDrilling(normalizeDrillingValue(e.target.value))}
                                                    onBlur={() => void commitCellEdit()}
                                                    className="h-[18px] w-full min-w-0 rounded-[5px] border border-[#94A3B8] bg-white px-1 text-[9px] text-[#0F172A]"
                                                  >
                                                    {DRILLING_OPTIONS.map((opt) => (
                                                      <option key={opt} value={opt}>{opt}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="grid grid-cols-2 gap-1">
                                                <select
                                                  autoFocus
                                                  value={editingClashLeft}
                                                  onChange={(e) => setEditingClashLeft(e.target.value)}
                                                  onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                      e.preventDefault();
                                                      void commitCellEdit();
                                                    }
                                                    if (e.key === "Escape") cancelCellEdit();
                                                  }}
                                                  className="h-6 w-full min-w-0 rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                                >
                                                  <option value=""></option>
                                                  {CLASH_LEFT_OPTIONS.map((opt) => (
                                                    <option key={opt} value={opt}>{opt}</option>
                                                  ))}
                                                </select>
                                                <select
                                                  value={editingClashRight}
                                                  onChange={(e) => setEditingClashRight(e.target.value)}
                                                  onBlur={() => void commitCellEdit()}
                                                  onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                      e.preventDefault();
                                                      void commitCellEdit();
                                                    }
                                                    if (e.key === "Escape") cancelCellEdit();
                                                  }}
                                                  className="h-6 w-full min-w-0 rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                                >
                                                  <option value=""></option>
                                                  {CLASH_RIGHT_OPTIONS.map((opt) => (
                                                    <option key={opt} value={opt}>{opt}</option>
                                                  ))}
                                                </select>
                                              </div>
                                            )
                                          ) : (
                                            rowIsCabinetry
                                              ? (
                                                <div className="grid min-h-[78px] grid-rows-4 gap-[2px] text-left text-[9px]">
                                                  <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                    <span className="font-bold">Fixed Shelf</span>
                                                    <span>{row.fixedShelf || ""}</span>
                                                  </div>
                                                  <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                    <span className="inline-flex items-center gap-[2px] font-bold">
                                                      <DrillingArrowIcon color={groupTextColor} />
                                                      Drilling
                                                    </span>
                                                    <span>{normalizeDrillingValue(row.fixedShelfDrilling)}</span>
                                                  </div>
                                                  <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                    <span className="font-bold">Adjustable Shelf</span>
                                                    <span>{row.adjustableShelf || ""}</span>
                                                  </div>
                                                  <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                    <span className="inline-flex items-center gap-[2px] font-bold">
                                                      <DrillingArrowIcon color={groupTextColor} />
                                                      Drilling
                                                    </span>
                                                    <span>{normalizeDrillingValue(row.adjustableShelfDrilling)}</span>
                                                  </div>
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
                                      (key === "height" && matchesGrainDimension(String(row.grainValue ?? ""), row.height)) ||
                                      (key === "width" && matchesGrainDimension(String(row.grainValue ?? ""), row.width)) ||
                                      (key === "depth" && matchesGrainDimension(String(row.grainValue ?? ""), row.depth));
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
                                            onChange={(e) => setEditingCellValue(e.target.value)}
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
                                    <td className="px-2 py-[3px] align-middle text-center text-[10px] font-bold">
                                      
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
                                      if (col.key === "grain") value = row.grainValue || (row.grain ? "Yes" : "");
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
                                {rowIsDrawer && drawerOpen && drawerPieces.map((piece, pieceIdx) => (
                                  <tr
                                    key={`${row.id}_${piece.key}`}
                                    data-cutlist-subrow-parent={row.id}
                                    data-cutlist-subrow-key={piece.key}
                                    className="border-t"
                                    style={{ backgroundColor: palette.headerBg, color: groupTextColor, borderTopColor: palette.divider }}
                                  >
                                    <td className="px-2 py-[3px] align-middle text-center text-[10px] font-bold"></td>
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
        </div>
      </ProtectedRoute>
    );
  }

  if (isCncFullscreen) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-[var(--bg-app)]">
          <div className="flex h-[56px] items-center justify-between border-b border-[#D7DEE8] bg-white px-4 md:px-5">
            <div className="inline-flex items-center gap-2 text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">
              <Cpu size={14} />
              <span>CNC Cutlist</span>
              <span className="text-[#6B7280]">|</span>
              <span className="truncate text-[#334155]">{project?.name || "Project"}</span>
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
          <div
            className="grid min-h-[calc(100dvh-56px)] items-start gap-3 p-3"
            style={{ gridTemplateColumns: "minmax(0, 1fr) 360px" }}
          >
            <section className="min-h-0 overflow-auto rounded-[12px] border border-[#D7DEE8] bg-white">
              <div className="flex min-h-[46px] flex-wrap items-center gap-2 border-b border-[#DCE3EC] px-3 py-2">
                <p className="rounded-[999px] border border-[#D6DEE9] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#334155]">
                  Rows: {filteredCncRows.length}
                </p>
                <p className="rounded-[999px] border border-[#D6DEE9] bg-[#EEF2F7] px-3 py-1 text-[11px] font-bold text-[#334155]">
                  Total Qty: {cncTotalQty}
                </p>
                <div className="ml-auto flex items-center gap-2">
                  <input
                    value={cncSearch}
                    onChange={(e) => setCncSearch(e.target.value)}
                    placeholder="Search pieces..."
                    className="h-8 w-[260px] rounded-[8px] border border-[#D8DEE8] bg-[#EEF1F5] px-2 text-[12px]"
                  />
                  <select
                    value={cncPartTypeFilter}
                    onChange={(e) => setCncPartTypeFilter(e.target.value)}
                    className="h-8 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  >
                    <option value="All Part Types">All Part Types</option>
                    {partTypeOptions.map((v) => (
                      <option key={`cnc_${v}`} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-3 p-3">
                {cncRowsByBoard.length === 0 && (
                  <div className="rounded-[10px] border border-dashed border-[#D8DEE8] bg-[#F8FAFC] px-3 py-8 text-center text-[12px] font-semibold text-[#667085]">
                    No visible CNC rows.
                  </div>
                )}
                {cncRowsByBoard.map((group) => (
                  <section key={group.boardKey} className="overflow-hidden rounded-[12px] border border-[#D7DEE8]">
                    <div className="flex h-[40px] items-center border-b border-[#DCE3EC] bg-[#F8FAFC] px-3">
                      <p className="text-[13px] font-medium text-[#12345B]">{group.boardLabel}</p>
                    </div>
                    <div className="overflow-auto">
                      <table className="w-full text-left text-[12px]">
                        <thead className="bg-[#E9EEF5] text-[#0F172A]">
                          <tr>
                            <th className="w-[56px] px-2 py-2 text-center">ID</th>
                            <th className="px-2 py-2">Room</th>
                            <th className="px-2 py-2">Part Type</th>
                            <th className="px-2 py-2">Part Name</th>
                            <th className="px-2 py-2 text-center">Height</th>
                            <th className="px-2 py-2 text-center">Width</th>
                            <th className="px-2 py-2 text-center">Depth</th>
                            <th className="px-2 py-2 text-center">Qty</th>
                            <th className="px-2 py-2 text-center">Clashing</th>
                            {showCncGrainColumn && <th className="px-2 py-2 text-center">Grain</th>}
                            <th className="px-2 py-2">Information</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row, idx) => {
                            const partColor = partTypeColors[row.partType || "Unassigned"] ?? "#CBD5E1";
                            const partText = isLightHex(partColor) ? "#111827" : "#F8FAFC";
                            return (
                              <tr key={`${group.boardKey}_${row.id}_${idx}`} className="border-t border-[#E4E7EE]">
                                <td className="px-2 py-[5px] text-center text-[#334155]">{idx + 1}</td>
                                <td className="px-2 py-[5px] text-[#334155]">{row.room || "-"}</td>
                                <td className="px-2 py-[5px]">
                                  <span
                                    className="inline-flex rounded-[7px] px-2 py-[1px] text-[11px] font-semibold"
                                    style={{ backgroundColor: partColor, color: partText }}
                                  >
                                    {row.partType || "Unassigned"}
                                  </span>
                                </td>
                                <td className="px-2 py-[5px] font-semibold text-[#0F172A]">{row.name || "-"}</td>
                                <td className="px-2 py-[5px] text-center text-[#334155]">{row.height || "-"}</td>
                                <td className="px-2 py-[5px] text-center text-[#334155]">{row.width || "-"}</td>
                                <td className="px-2 py-[5px] text-center text-[#334155]">{row.depth || "-"}</td>
                                <td className="px-2 py-[5px] text-center font-bold text-[#0F172A]">{row.quantity || "-"}</td>
                                <td className="px-2 py-[5px] text-center text-[#334155]">{joinClashing(row.clashLeft ?? "", row.clashRight ?? "") || row.clashing || "-"}</td>
                                {showCncGrainColumn && (
                                  <td className="px-2 py-[5px] text-center text-[#334155]">{row.grainValue || (row.grain ? "Yes" : "")}</td>
                                )}
                                <td className="px-2 py-[5px] text-[#334155]">{row.information || "-"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </div>
            </section>
            <section className="self-start min-h-0 overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white h-[calc(100dvh-80px)]">
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
              <div className="h-[calc(100%-94px)] overflow-auto px-3 pb-3">
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
                  { label: "Initial Measure", icon: Ruler },
                  { label: "Items", icon: ListChecks },
                  { label: "Quote", icon: Quote },
                  { label: "Specifications", icon: ClipboardList },
                ].map((item, idx, arr) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="w-full sm:w-auto xl:w-full">
                    <button
                      type="button"
                      disabled={salesReadOnly}
                      className="inline-flex w-full min-w-0 items-center gap-2 whitespace-nowrap pl-0 pr-2 py-3 text-left text-[13px] font-semibold text-[#243B58] hover:bg-[#EEF2F7] disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto sm:min-w-[120px] xl:w-full xl:min-w-0 xl:whitespace-normal"
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

              <div className="isolate mt-2 w-full max-w-[1120px] space-y-4 px-3 sm:px-4 md:px-5 xl:mt-4 xl:px-0">
              {salesReadOnly && (
                <div className="rounded-[10px] border border-[#D6DEE9] bg-[#EEF2F7] px-3 py-2 text-[12px] font-semibold text-[#334155]">
                  Sales is in read-only mode for your account.
                </div>
              )}
                <div className="grid gap-4 xl:grid-cols-[430px_1fr_1fr]">
                  <section className="rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                    <div className="flex h-[50px] items-center justify-between border-b border-[#D7DEE8] px-4">
                      <p className="text-[14px] font-medium tracking-[1px] text-[#0F2A4A]">ROOMS</p>
                      <button disabled={salesReadOnly} className="text-[12px] font-bold text-[#7E9EBB]">
                        + Add Room
                      </button>
                    </div>
                    <div className="p-3">
                      <div className="mb-2 grid grid-cols-[24px_1fr_100px_64px] gap-2 text-[11px] font-bold text-[#8A97A8]">
                        <p></p><p>Room</p><p className="text-right">Price</p><p className="text-center">Included</p>
                      </div>
                      <div className="space-y-1">
                        {(salesRoomRows.length ? salesRoomRows : [{ name: "Main Room", included: true, totalPrice: "0.00" }]).map((room) => (
                          <div key={room.name} className="grid grid-cols-[24px_1fr_100px_64px] items-center gap-2 border-b border-[#DDE4EE] py-2">
                            <button
                              disabled={salesReadOnly}
                              className="h-6 w-6 rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[11px] font-bold text-[#C62828] disabled:cursor-not-allowed disabled:opacity-55"
                            >
                              x
                            </button>
                            <p className="text-[12px] font-semibold text-[#0F172A]">{room.name}</p>
                            <p className="text-right text-[12px] font-semibold italic text-[#0F172A]">${room.totalPrice}</p>
                            <p className={`text-center text-[12px] font-bold ${room.included ? "text-[#7BCB90]" : "text-[#98A2B3]"}`}>
                              {room.included ? "Yes" : "No"}
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <button disabled={salesReadOnly} className="text-[12px] font-bold text-[#7E9EBB]">
                          + Add Room
                        </button>
                        <p className="text-[36px] font-extrabold text-[#7E9EBB]">Total $0.00</p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                    <div className="flex h-[50px] items-center border-b border-[#D7DEE8] px-4">
                      <p className="text-[14px] font-medium tracking-[1px] text-[#0F2A4A]">PRODUCT</p>
                    </div>
                    <div className="space-y-2 p-4 text-[12px]">
                      {["Melteca", "Woodgrain", "Lacquer (1 side)", "Lacquer (2 side)"].map((item) => (
                        <label key={item} className="flex items-center gap-2 text-[#1F2937]">
                          <input type="checkbox" disabled={salesReadOnly} className="h-[12px] w-[12px]" />
                          <span className="font-semibold">{item}</span>
                        </label>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                    <div className="flex h-[50px] items-center border-b border-[#D7DEE8] px-4">
                      <p className="text-[14px] font-medium tracking-[1px] text-[#0F2A4A]">QUOTE EXTRAS</p>
                    </div>
                    <div className="space-y-2 p-4 text-[12px]">
                      {["Dear Client....", "Removal of small appliances", "Include Sundries", "Include Colour Consultation", "Include Promotional Discount", "Include GST"].map((item) => (
                        <label key={item} className="flex items-center gap-2 text-[#1F2937]">
                          <input type="checkbox" disabled={salesReadOnly} className="h-[12px] w-[12px]" />
                          <span className="font-semibold">{item}</span>
                        </label>
                      ))}
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
                  productionNav === "cutlist"
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
                            <input disabled={productionReadOnly} title={warningForCell("single", "name") || undefined} value={cutlistEntry.name} onChange={(e) => setCutlistEntry((prev) => ({ ...prev, name: e.target.value }))} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] ${warningClassForCell("single", "name")}`} style={{ ...warningStyleForCell("single", "name", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }), ...cutlistEntryCellStyle("name") }} />
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
                              <input disabled={productionReadOnly} title={warningForCell("single", "height") || undefined} value={cutlistEntry.height} onChange={(e) => setCutlistEntry((prev) => ({ ...prev, height: e.target.value }))} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center ${warningClassForCell("single", "height")}`} style={{ ...warningStyleForCell("single", "height", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }), ...(singleEntryHeightGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : {}), ...cutlistEntryCellStyle("height") }} />
                            )}
                            <input disabled={productionReadOnly} title={warningForCell("single", "width") || undefined} value={cutlistEntry.width} onChange={(e) => setCutlistEntry((prev) => ({ ...prev, width: e.target.value }))} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center ${warningClassForCell("single", "width")}`} style={{ ...warningStyleForCell("single", "width", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }), ...(singleEntryWidthGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : {}), ...cutlistEntryCellStyle("width") }} />
                            <input disabled={productionReadOnly} title={warningForCell("single", "depth") || undefined} value={cutlistEntry.depth} onChange={(e) => setCutlistEntry((prev) => ({ ...prev, depth: e.target.value }))} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center ${warningClassForCell("single", "depth")}`} style={{ ...warningStyleForCell("single", "depth", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }), ...(singleEntryDepthGrainMatch ? { fontWeight: 700, textDecoration: "underline" } : {}), ...cutlistEntryCellStyle("depth") }} />
                            <input disabled={productionReadOnly || isDrawerPartType(cutlistEntry.partType)} title={warningForCell("single", "quantity") || undefined} value={cutlistEntry.quantity} onChange={(e) => setCutlistEntry((prev) => ({ ...prev, quantity: e.target.value }))} className={`h-8 rounded-[8px] border bg-transparent px-2 text-[12px] text-center disabled:opacity-90 ${warningClassForCell("single", "quantity")}`} style={{ ...warningStyleForCell("single", "quantity", { backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }), ...cutlistEntryCellStyle("quantity") }} />
                            <select
                              disabled={productionReadOnly}
                              value={cutlistEntry.clashLeft ?? ""}
                              onChange={(e) => setCutlistEntry((prev) => ({ ...prev, clashLeft: e.target.value }))}
                              className="h-8 rounded-[8px] border bg-transparent px-1 text-[12px] text-center"
                              style={{ ...cutlistEntrySubCellStyle("clashing", 0), backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }}
                            >
                              <option value=""></option>
                              {CLASH_LEFT_OPTIONS.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                            <select
                              disabled={productionReadOnly}
                              value={cutlistEntry.clashRight ?? ""}
                              onChange={(e) => setCutlistEntry((prev) => ({ ...prev, clashRight: e.target.value }))}
                              className="h-8 rounded-[8px] border bg-transparent px-1 text-[12px] text-center"
                              style={{ ...cutlistEntrySubCellStyle("clashing", 1), backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }}
                            >
                              <option value=""></option>
                              {CLASH_RIGHT_OPTIONS.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
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
                                <select
                                  disabled={productionReadOnly}
                                  value={String(cutlistEntry.grainValue ?? "")}
                                  onChange={(e) =>
                                    setCutlistEntry((prev) => ({
                                      ...prev,
                                      grainValue: e.target.value,
                                      grain: Boolean(String(e.target.value).trim()),
                                    }))
                                  }
                                  className="h-8 rounded-[8px] border bg-transparent px-1 text-[12px] text-center"
                                  style={{ ...cutlistEntryCellStyle("grain"), backgroundColor: activeCutlistEntryFieldBg, borderColor: activeCutlistEntryFieldBorder, color: activeCutlistEntryTextColor }}
                                >
                                  <option value=""></option>
                                  {grainDimensionOptions(cutlistEntry.height, cutlistEntry.width, cutlistEntry.depth).map((opt) => (
                                    <option key={`entry_grain_${opt}`} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
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
                                            className="h-6 min-w-[130px] rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
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
                                                className="h-6 min-w-[130px] rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                              >
                                                <option value=""></option>
                                                {options.map((opt) => (
                                                  <option key={opt} value={opt}>{boardOptionLabel(opt)}</option>
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
                                                className="h-6 min-w-[170px] rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                              >
                                                <option value=""></option>
                                                {options.map((opt) => (
                                                  <option key={opt} value={opt}>{boardOptionLabel(opt)}</option>
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
                                              <select
                                                autoFocus
                                                value={editingCellValue}
                                                onChange={(e) => {
                                                  const v = e.target.value;
                                                  setEditingCellValue(v);
                                                  void commitCellEdit(v);
                                                }}
                                                onBlur={() => void commitCellEdit()}
                                                className="h-6 min-w-[72px] rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                              >
                                                <option value=""></option>
                                                {grainDimensionOptions(row.height, row.width, row.depth).map((opt) => (
                                                  <option key={`${row.id}_grain_edit_${opt}`} value={opt}>
                                                    {opt}
                                                  </option>
                                                ))}
                                              </select>
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
                                                <div className="grid gap-[1px] text-left">
                                                  <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                    <span className="text-[9px] font-bold leading-none">Fixed Shelf</span>
                                                    <input
                                                      autoFocus
                                                      value={editingFixedShelf}
                                                      onChange={(e) => setEditingFixedShelf(e.target.value)}
                                                      onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                          e.preventDefault();
                                                          void commitCellEdit();
                                                        }
                                                        if (e.key === "Escape") cancelCellEdit();
                                                      }}
                                                    className="h-[18px] w-full min-w-0 rounded-[5px] border border-[#94A3B8] bg-white px-1 text-[9px] text-[#0F172A]"
                                                    />
                                                  </div>
                                                  <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                    <span className="inline-flex items-center gap-[2px] text-[9px] font-bold leading-none">
                                                      <DrillingArrowIcon color={rowTextColor} />
                                                      Drilling
                                                    </span>
                                                    <select
                                                      value={editingFixedShelfDrilling}
                                                      onChange={(e) => setEditingFixedShelfDrilling(normalizeDrillingValue(e.target.value))}
                                                    className="h-[18px] w-full min-w-0 rounded-[5px] border border-[#94A3B8] bg-white px-1 text-[9px] text-[#0F172A]"
                                                    >
                                                      {DRILLING_OPTIONS.map((opt) => (
                                                        <option key={opt} value={opt}>{opt}</option>
                                                      ))}
                                                    </select>
                                                  </div>
                                                  <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                    <span className="text-[9px] font-bold leading-none">Adjustable Shelf</span>
                                                    <input
                                                      value={editingAdjustableShelf}
                                                      onChange={(e) => setEditingAdjustableShelf(e.target.value)}
                                                      onBlur={() => void commitCellEdit()}
                                                      onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                          e.preventDefault();
                                                          void commitCellEdit();
                                                        }
                                                        if (e.key === "Escape") cancelCellEdit();
                                                      }}
                                                    className="h-[18px] w-full min-w-0 rounded-[5px] border border-[#94A3B8] bg-white px-1 text-[9px] text-[#0F172A]"
                                                    />
                                                  </div>
                                                  <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                    <span className="inline-flex items-center gap-[2px] text-[9px] font-bold leading-none">
                                                      <DrillingArrowIcon color={rowTextColor} />
                                                      Drilling
                                                    </span>
                                                    <select
                                                      value={editingAdjustableShelfDrilling}
                                                      onChange={(e) => setEditingAdjustableShelfDrilling(normalizeDrillingValue(e.target.value))}
                                                      onBlur={() => void commitCellEdit()}
                                                    className="h-[18px] w-full min-w-0 rounded-[5px] border border-[#94A3B8] bg-white px-1 text-[9px] text-[#0F172A]"
                                                    >
                                                      {DRILLING_OPTIONS.map((opt) => (
                                                        <option key={opt} value={opt}>{opt}</option>
                                                      ))}
                                                    </select>
                                                  </div>
                                                </div>
                                              ) : (
                                              <div className="grid grid-cols-2 gap-1">
                                                  <select
                                                    autoFocus
                                                    value={editingClashLeft}
                                                    onChange={(e) => setEditingClashLeft(e.target.value)}
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        void commitCellEdit();
                                                      }
                                                      if (e.key === "Escape") cancelCellEdit();
                                                    }}
                                                  className="h-6 w-full min-w-0 rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                                  >
                                                    <option value=""></option>
                                                    {CLASH_LEFT_OPTIONS.map((opt) => (
                                                      <option key={opt} value={opt}>{opt}</option>
                                                    ))}
                                                  </select>
                                                  <select
                                                    value={editingClashRight}
                                                    onChange={(e) => setEditingClashRight(e.target.value)}
                                                    onBlur={() => void commitCellEdit()}
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        void commitCellEdit();
                                                      }
                                                      if (e.key === "Escape") cancelCellEdit();
                                                    }}
                                                  className="h-6 w-full min-w-0 rounded-[6px] border border-[#94A3B8] bg-white px-1 text-[11px] text-[#0F172A]"
                                                  >
                                                    <option value=""></option>
                                                    {CLASH_RIGHT_OPTIONS.map((opt) => (
                                                      <option key={opt} value={opt}>{opt}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                              )
                                            ) : (
                                              rowIsCabinetry ? (
                                                <div className="grid min-h-[78px] grid-rows-4 gap-[2px] text-left text-[9px]">
                                                  <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                    <span className="font-bold">Fixed Shelf</span>
                                                    <span>{row.fixedShelf || ""}</span>
                                                  </div>
                                                  <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                    <span className="inline-flex items-center gap-[2px] font-bold">
                                                      <DrillingArrowIcon color={rowTextColor} />
                                                      Drilling
                                                    </span>
                                                    <span>{normalizeDrillingValue(row.fixedShelfDrilling)}</span>
                                                  </div>
                                                  <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                    <span className="font-bold">Adjustable Shelf</span>
                                                    <span>{row.adjustableShelf || ""}</span>
                                                  </div>
                                                  <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-[2px]">
                                                    <span className="inline-flex items-center gap-[2px] font-bold">
                                                      <DrillingArrowIcon color={rowTextColor} />
                                                      Drilling
                                                    </span>
                                                    <span>{normalizeDrillingValue(row.adjustableShelfDrilling)}</span>
                                                  </div>
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
                                        (key === "height" && matchesGrainDimension(String(row.grainValue ?? ""), row.height)) ||
                                        (key === "width" && matchesGrainDimension(String(row.grainValue ?? ""), row.width)) ||
                                        (key === "depth" && matchesGrainDimension(String(row.grainValue ?? ""), row.depth));
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
                                            <input
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
                    <div className="grid grid-cols-[24px_1fr_80px_80px_80px_50px_60px_110px_45px_70px] items-center gap-2 text-[11px] font-bold text-[#8A97A8]">
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
                    <datalist id="board-colour-suggestions">
                      {boardColourSuggestions.map((colour) => (
                        <option key={colour} value={colour} />
                      ))}
                    </datalist>
                    <div className="mt-2 space-y-2">
                      {productionForm.boardTypes.map((row) => (
                        <div key={row.id} className="grid grid-cols-[24px_1fr_80px_80px_80px_50px_60px_110px_45px_70px] items-center gap-2">
                          {(() => {
                            const requiredSheets = requiredSheetCountByBoardRowId[row.id] ?? 0;
                            return (
                              <>
                          <button
                            disabled={productionReadOnly}
                            onClick={() => void onRemoveBoardRow(row.id)}
                            className="h-6 w-6 rounded-[8px] border border-[#F4B5B5] bg-[#FCEAEA] text-[11px] font-bold text-[#C62828] disabled:opacity-55"
                          >
                            x
                          </button>
                          <input
                            disabled={productionReadOnly}
                            value={row.colour}
                            list="board-colour-suggestions"
                            onFocus={() => {
                              boardColourEditStartRef.current[row.id] = String(row.colour || "").trim();
                            }}
                            onChange={(e) => onBoardFieldDraftChange(row.id, { colour: e.target.value })}
                            onBlur={(e) => {
                              const previousColour = boardColourEditStartRef.current[row.id] ?? "";
                              delete boardColourEditStartRef.current[row.id];
                              void onBoardFieldCommit(row.id, { colour: e.target.value }, true, previousColour);
                            }}
                            className="h-7 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                          />
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
                          <p className="text-center text-[12px] font-semibold text-[#344054]">{row.edgetape}</p>
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
                <CardHeader className="flex-row items-center justify-between border-b border-[#D7DEE8] pb-2">
                  <CardTitle className="text-[14px] font-medium uppercase tracking-[1px] text-[#12345B]">Project Permissions</CardTitle>
                  <button className="rounded-[8px] border border-[#D8DEE8] bg-[#EEF2F7] px-3 py-1 text-[12px] font-bold text-[#44688F]">
                    Change Ownership
                  </button>
                </CardHeader>
                <CardContent className="pt-1 text-[12px]">
                  {permissionRows.map((row) => (
                    <div key={row.uid} className="grid grid-cols-[1fr_120px_120px] items-center gap-2 border-b border-[#DCE3EC] py-[8px]">
                      <p className="font-semibold text-[#334155]">{row.displayName}</p>
                      <select className="h-7 rounded-[8px] border border-[#D8DEE8] bg-[#F8FAFC] px-2 text-[12px] font-semibold text-[#475467]">
                        <option>{row.role === "owner" || row.role === "admin" ? "Edit" : "View"}</option>
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
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}















