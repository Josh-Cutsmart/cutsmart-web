"use client";

import type { Worksheet } from "exceljs";
import { activeUnit, activeUnitLabel, formatLength } from "@/lib/company-formats";
import type { CutlistRow } from "@/lib/cutlist-types";

// A project's cutlist (Production or Initial Measure) as an Excel file, laid out like its on-screen cutlist list — from
// the download button in the cutlist's top bar:
// - its title (the project, and which cutlist), then a section for each part type in the company's order: a bar in the
//   part type's colour with its name and how many parts, its column headings, then its rows washed in a lighter shade;
// - every field a row has: its room, board, part name, sizes (in the company's unit — plain numbers, so they
//   add up), quantity, clashing, information and grain (the grain's size bold and underlined, its side in blue, as the
//   list's grain toggle shows it) — then, only in the sections that use them, the cabinet's shelves and drilling, the
//   door / drawer fronts, the hinges, and whether it's left out of nesting.
// exceljs is only loaded when one's made.

export type CutlistExcelInput = {
  // "Production Cutlist" / "Initial Measure".
  title: string;
  projectName: string;
  // Under the title: the client, and when it was downloaded.
  subtitle: string;
  rows: CutlistRow[];
  // Part type name → its colour, and the company's order (Company Settings › Production › Part types).
  partTypeColors: Record<string, string>;
  partTypeOrder: string[];
  // A row's board, as the list shows it (its name).
  boardOf: (value: string) => { label: string };
};

type Cell = string | number;
type Column = {
  key: string;
  header: string;
  width: number;
  value: (row: CutlistRow) => Cell;
  // A size: in the company's unit, and the one the grain may run along.
  length?: "height" | "width" | "depth";
  align?: "left" | "center" | "right";
  // Only in sections where a row has something for it.
  optional?: boolean;
};

const toStr = (value: unknown) => String(value ?? "").trim();
const joined = (values: unknown, separator: string) => (Array.isArray(values) ? values.map(toStr).filter(Boolean).join(separator) : "");

const hexToRgb = (hex: string): [number, number, number] | null => {
  const match = String(hex || "").trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!match) return null;
  const value = match[1].length === 3 ? match[1].split("").map((c) => c + c).join("") : match[1];
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)];
};
// Excel's colours ("FFRRGGBB"): the part type's own, or towards white (keep: how much of the colour stays).
const argb = (rgb: [number, number, number]) => `FF${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
const tint = (rgb: [number, number, number], keep: number): [number, number, number] =>
  rgb.map((channel) => Math.round(255 - (255 - channel) * keep)) as [number, number, number];
const isLight = (rgb: [number, number, number]) => (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.6;
const FALLBACK_COLOUR: [number, number, number] = [203, 213, 225];
const GRAIN_BLUE = "FF2563EB";
const LINE = "FFE2E8F0";

// Which size a row's grain runs along: "H:716"-style, or a number matching one of its sizes; with grain but no side
// picked, its first size (as the list's toggle shows it).
function grainAxis(row: CutlistRow): "height" | "width" | "depth" | null {
  const grain = toStr(row.grainValue) || (row.grain ? "yes" : "");
  if (!grain) return null;
  const prefixed = grain.match(/^([HWD])\s*:/i);
  if (prefixed) return prefixed[1].toUpperCase() === "H" ? "height" : prefixed[1].toUpperCase() === "W" ? "width" : "depth";
  const value = Number.parseFloat(grain);
  if (Number.isFinite(value)) {
    for (const key of ["height", "width", "depth"] as const) {
      const size = Number.parseFloat(toStr(row[key]));
      if (Number.isFinite(size) && Math.abs(size - value) < 0.001) return key;
    }
  }
  return toStr(row.height) ? "height" : toStr(row.width) ? "width" : toStr(row.depth) ? "depth" : null;
}

// A Drawer row's depth for each of its drawers (CutlistRow.drawerDepths, by "B#2" — the first drawer's is the row's
// Depth, the others' their own if set, else that), as "A 560, B 500, B 480" — only for a row of more than one drawer.
function drawerDepthsText(row: CutlistRow, size: (value: unknown) => Cell): string {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  for (const token of toStr(row.height).split(/[,+/\\\s]+/)) {
    const height = token.trim().toUpperCase();
    if (!height) continue;
    const nth = (counts.get(height) ?? 0) + 1;
    counts.set(height, nth);
    keys.push(`${height}#${nth}`);
  }
  if (keys.length < 2) return "";
  return keys
    .map((key, index) => {
      const height = key.split("#")[0];
      return `${height} ${size(index === 0 ? row.depth : toStr(row.drawerDepths?.[key]) || row.depth)}`;
    })
    .join(", ");
}

export async function buildCutlistExcelBlob(input: CutlistExcelInput): Promise<Blob | null> {
  const rows = input.rows.filter((row) => toStr(row.name) || toStr(row.height) || toStr(row.width));
  if (!rows.length) return null;
  const unit = activeUnit();
  const unitSuffix = activeUnitLabel() ? ` (${activeUnitLabel()})` : "";
  // A stored size (mm) as the company shows it — a plain number in mm (or a number in its unit when it converts to one).
  const size = (value: unknown): Cell => {
    const raw = toStr(value);
    if (!/^-?\d+(\.\d+)?$/.test(raw)) return raw;
    if (unit === "mm") return Number(raw);
    const shown = formatLength(raw, unit, { withUnit: false });
    return /^-?\d+(\.\d+)?$/.test(shown) ? Number(shown) : shown;
  };
  const yes = (value: unknown) => (value === true ? "Yes" : "");
  // A row set up as doors or drawers (its fronts worked out for it) — the only ones whose fronts' columns mean anything
  // (everything else has them at their defaults).
  const hasFronts = (row: CutlistRow) => row.doorMode === "door" || row.doorMode === "drawer";

  const columns: Column[] = [
    { key: "room", header: "Room", width: 18, value: (row) => toStr(row.room) },
    { key: "board", header: "Board", width: 30, value: (row) => input.boardOf(toStr(row.board)).label },
    { key: "name", header: "Part Name", width: 28, value: (row) => toStr(row.name) },
    { key: "height", header: `Height${unitSuffix}`, width: 12, value: (row) => size(row.height), length: "height", align: "center" },
    { key: "width", header: `Width${unitSuffix}`, width: 12, value: (row) => size(row.width), length: "width", align: "center" },
    { key: "depth", header: `Depth${unitSuffix}`, width: 12, value: (row) => size(row.depth), length: "depth", align: "center", optional: true },
    // A drawer bank's depth for each of its drawers, when it's more than one ("A 560, B 500, B 480").
    { key: "drawerDepths", header: `Drawer Depths${unitSuffix}`, width: 20, value: (row) => drawerDepthsText(row, size), optional: true },
    {
      key: "quantity",
      header: "Quantity",
      width: 10,
      value: (row) => (/^\d+(\.\d+)?$/.test(toStr(row.quantity)) ? Number(row.quantity) : toStr(row.quantity)),
      align: "center",
    },
    {
      key: "clashing",
      header: "Clashing",
      width: 11,
      value: (row) => toStr(row.clashing) || [toStr(row.clashLeft), toStr(row.clashRight)].filter(Boolean).join(" "),
      align: "center",
    },
    { key: "information", header: "Information", width: 32, value: (row) => toStr(row.information) },
    {
      key: "grain",
      header: "Grain",
      width: 9,
      value: (row) => ({ height: "H", width: "W", depth: "D", none: "" })[grainAxis(row) ?? "none"],
      align: "center",
      optional: true,
    },
    // The cabinet's
    { key: "cabinet", header: "Cabinet", width: 10, value: (row) => (row.cabinetryKind === "wall" ? "Wall" : row.cabinetryKind === "base" ? "Base" : ""), optional: true },
    { key: "fixedShelf", header: "Fixed Shelves", width: 13, value: (row) => toStr(row.fixedShelf), align: "center", optional: true },
    {
      key: "fixedDrilling",
      header: "Fixed Drilling",
      width: 13,
      value: (row) => (toStr(row.fixedShelf) ? toStr(row.fixedShelfDrilling) : ""),
      align: "center",
      optional: true,
    },
    { key: "adjustableShelf", header: "Adjustable Shelves", width: 17, value: (row) => toStr(row.adjustableShelf), align: "center", optional: true },
    {
      key: "adjustableDrilling",
      header: "Adjustable Drilling",
      width: 17,
      value: (row) => (toStr(row.adjustableShelf) ? toStr(row.adjustableShelfDrilling) : ""),
      align: "center",
      optional: true,
    },
    { key: "clashBottom", header: "Clash Bottom", width: 13, value: (row) => toStr(row.cabinetryClashBottom), align: "center", optional: true },
    { key: "fullTop", header: "Full Top", width: 9, value: (row) => yes(row.cabinetryFullTop), align: "center", optional: true },
    // A door's / drawer's fronts
    {
      key: "doorMode",
      header: "Fronts As",
      width: 11,
      value: (row) => (row.doorMode === "door" ? "Doors" : row.doorMode === "drawer" ? "Drawers" : ""),
      optional: true,
    },
    { key: "doorFrontCount", header: "Fronts", width: 8, value: (row) => (hasFronts(row) ? toStr(row.doorFrontCount) : ""), align: "center", optional: true },
    { key: "doorTopGap", header: `Top Gap${unitSuffix}`, width: 13, value: (row) => (hasFronts(row) ? size(row.doorTopGap) : ""), align: "center", optional: true },
    {
      key: "doorBetweenGap",
      header: `Gap Between${unitSuffix}`,
      width: 16,
      value: (row) => (hasFronts(row) ? size(row.doorBetweenGap) : ""),
      align: "center",
      optional: true,
    },
    {
      key: "doorLeft",
      header: "Left Side",
      width: 14,
      value: (row) =>
        hasFronts(row) && row.doorSideLeft ? `${row.doorSideLeft === "panel" ? "Panel" : "Front"}${toStr(row.doorSideLeftGap) ? ` · ${row.doorSideLeftGap}` : ""}` : "",
      optional: true,
    },
    {
      key: "doorRight",
      header: "Right Side",
      width: 14,
      value: (row) =>
        hasFronts(row) && row.doorSideRight ? `${row.doorSideRight === "panel" ? "Panel" : "Front"}${toStr(row.doorSideRightGap) ? ` · ${row.doorSideRightGap}` : ""}` : "",
      optional: true,
    },
    { key: "frontWidths", header: "Front Widths", width: 18, value: (row) => (hasFronts(row) ? joined(row.doorFrontWidths, " / ") : ""), optional: true },
    { key: "frontHeights", header: "Front Heights", width: 18, value: (row) => (hasFronts(row) ? joined(row.doorFrontHeights, " / ") : ""), optional: true },
    // Hinges
    { key: "hingesUp", header: "Hinges Up", width: 16, value: (row) => joined(row.hingesUp, ", "), optional: true },
    { key: "hingesDown", header: "Hinges Down", width: 16, value: (row) => joined(row.hingesDown, ", "), optional: true },
    { key: "hingeSide", header: "Hinge Side", width: 11, value: (row) => toStr(row.hingeSide), align: "center", optional: true },
    // And the rest
    { key: "nesting", header: "In Nesting", width: 11, value: (row) => (row.includeInNesting === false ? "No" : ""), align: "center", optional: true },
    { key: "parent", header: "Part Of", width: 18, value: (row) => toStr(row.parentName), optional: true },
  ];

  // By part type: the company's order first, then any others as they come (as the list's sections).
  const orderOf = (type: string) => {
    const index = input.partTypeOrder.findIndex((name) => name.toLowerCase() === type.toLowerCase());
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const sections: Array<{ type: string; rows: CutlistRow[] }> = [];
  for (const row of rows) {
    const type = toStr(row.partType) || "Unassigned";
    const section = sections.find((item) => item.type.toLowerCase() === type.toLowerCase());
    if (section) section.rows.push(row);
    else sections.push({ type, rows: [row] });
  }
  sections.sort((a, b) => orderOf(a.type) - orderOf(b.type));
  // Each section's own columns: everything the list shows, and the optional ones its rows use.
  const sectionColumns = sections.map((section) =>
    columns.filter((column) => !column.optional || section.rows.some((row) => toStr(column.value(row)) !== "")),
  );
  const columnCount = Math.max(...sectionColumns.map((list) => list.length));

  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = "CutSmart";
  workbook.created = new Date();
  const sheet: Worksheet = workbook.addWorksheet("Cutlist", {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  sheet.headerFooter.oddFooter = `&L${input.projectName.replace(/&/g, "&&")} — ${input.title}&RPage &P of &N`;
  // Each column as wide as the widest it is in any section.
  for (let index = 0; index < columnCount; index += 1) {
    sheet.getColumn(index + 1).width = Math.max(...sectionColumns.map((list) => list[index]?.width ?? 8));
  }

  const titleRow = sheet.addRow([`${input.projectName} — ${input.title}`]);
  titleRow.font = { bold: true, size: 16, color: { argb: "FF0F172A" } };
  titleRow.height = 26;
  const subtitleRow = sheet.addRow([input.subtitle]);
  subtitleRow.font = { size: 11, color: { argb: "FF64748B" } };
  sheet.addRow([]);

  const border = { style: "thin" as const, color: { argb: LINE } };
  sections.forEach((section, sectionIndex) => {
    const list = sectionColumns[sectionIndex];
    const colour = hexToRgb(input.partTypeColors[section.type] ?? "") ?? FALLBACK_COLOUR;
    const parts = section.rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);

    // Its bar: the part type's name and how many parts, in its colour.
    const bar = sheet.addRow([`${section.type}   ·   ${parts} ${parts === 1 ? "part" : "parts"}`]);
    sheet.mergeCells(bar.number, 1, bar.number, list.length);
    bar.height = 24;
    const barCell = bar.getCell(1);
    barCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(colour) } };
    barCell.font = { bold: true, size: 12.5, color: { argb: isLight(colour) ? "FF111111" : "FFFFFFFF" } };
    barCell.alignment = { vertical: "middle", indent: 1 };

    // Its column headings.
    const headings = sheet.addRow(list.map((column) => column.header));
    headings.height = 20;
    list.forEach((column, index) => {
      const cell = headings.getCell(index + 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(tint(colour, 0.45)) } };
      cell.font = { bold: true, size: 10, color: { argb: "FF0F172A" } };
      cell.alignment = { vertical: "middle", horizontal: column.align ?? "left", wrapText: true };
      cell.border = { bottom: border };
    });

    // Its rows, washed lighter (every other one a little more).
    section.rows.forEach((row, rowIndex) => {
      const axis = grainAxis(row);
      const line = sheet.addRow(list.map((column) => column.value(row)));
      line.height = 19;
      const fill = argb(tint(colour, rowIndex % 2 === 0 ? 0.2 : 0.11));
      list.forEach((column, index) => {
        const cell = line.getCell(index + 1);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        cell.font = { size: 10.5, color: { argb: "FF111111" } };
        cell.alignment = { vertical: "middle", horizontal: column.align ?? "left", wrapText: column.key === "information" };
        cell.border = { bottom: border };
        // The size the grain runs along: bold and underlined; its side, in blue.
        if (column.length && column.length === axis) cell.font = { size: 10.5, bold: true, underline: true, color: { argb: "FF111111" } };
        if (column.key === "grain" && axis) cell.font = { size: 10.5, bold: true, color: { argb: GRAIN_BLUE } };
      });
    });
    sheet.addRow([]);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// Saved as "<Project> - <Title>.xlsx". False when there's nothing in the cutlist to save.
export async function downloadCutlistExcel(input: CutlistExcelInput): Promise<boolean> {
  const blob = await buildCutlistExcelBlob(input);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${`${input.projectName || "Project"} - ${input.title}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
  return true;
}
