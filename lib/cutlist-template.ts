// Production › Downloads › Production Cutlist: a blank production workbook (.xlsx) — the company's, for any project —
// to fill in offline and bring back with Production › Import, which brings in the whole Production tab from it.
//
// "Dashboard" (first): Project Details; Global Job Selections (Existing Cabinetry's thicknesses, Cabinetry's heights,
// the hardware and handles); Project Sections (the rooms — a company room, a name after it, and its own drawer type or
// Global); Board Types & Finishes (ten, with the company's thicknesses / finishes / sheet sizes as dropdowns — they make
// the rooms' Board dropdowns); and the Order Section (drawers counted from the rooms, hinges, other and misc).
// "Room 1"…: a sheet per room — its Room picked from Project Sections, its drawer type following that section — and the
// cutlist's columns, the cabinetry-only ones grouped at the end and greyed out for other part types, each row in its
// part type's colour, and Height a dropdown of the drawer type's heights on a drawer row only. "Notes": a box for the
// project's notes and each contractor's. "Lists": the company's settings the dropdowns use (part types and their
// colours, drawer types and sizes, hardware, boards' options, staff, rooms), as they are in Company Settings at
// download.
//
// Built for Excel: each dropdown is a plain range of cells (the Lists sheet's, or worked-out cells beside them) rather
// than a named range or INDIRECT; the yes / no ones (Top Scribers, Grain, Lacquer, Full Top) are Excel's own tick boxes
// (addCellCheckboxes — ticked is yes).
//
// parseCutlistTemplateWorkbook reads one back (recognised by the Lists sheet's first cell — or an older template's
// "Data" sheet), by its headings and labels rather than fixed cells.

import type { Cell, DataValidation, Workbook, Worksheet } from "exceljs";

export const CUTLIST_TEMPLATE_MARKER = "CutSmart Cutlist Template";
const DASHBOARD_SHEET = "Dashboard";
const NOTES_SHEET = "Notes";
const LISTS_SHEET = "Lists";
// An older template's sheet of boards and lists (before the Dashboard).
const LEGACY_DATA_SHEET = "Data";
const NOT_ROOM_SHEETS = [DASHBOARD_SHEET, NOTES_SHEET, LISTS_SHEET, LEGACY_DATA_SHEET].map((name) => name.toLowerCase());
// The rooms' rows, the Dashboard's sections rows (its boards' beside them: fewer), and its order rows, that get dropdowns.
const TEMPLATE_PART_ROWS = 300;
const DASHBOARD_TABLE_ROWS = 20;
const BOARD_ROWS = 10;
const ORDER_ROWS = 15;
const NOTE_BOX_ROWS = 8;
// The Notes sheet's hidden column holding each box's key ("notes", or "contractor:<name>") on its title row.
const NOTE_KEY_COLUMN = 10;
// A section's drawer type when it follows the Dashboard's (Global Job Selections').
const GLOBAL_DRAWER_TYPE = "Global";

export type CutlistTemplatePartKind = "Cabinetry" | "Drawer" | "Door" | "";
export type CutlistTemplateBoard = {
  colour: string;
  thickness: string;
  finish: string;
  sheetSize: string;
  edging: string;
  grain: boolean;
  lacquer: boolean;
  edgeTape: string;
  sheets: string;
};
// A hardware brand (Company Settings › Hardware): its drawer types (with their heights), hinges and other items.
export type CutlistTemplateHardware = {
  name: string;
  drawers: Array<{ name: string; heights: Array<{ letter: string; size: string }> }>;
  hinges: string[];
  other: string[];
};
export type CutlistTemplateInput = {
  companyName: string;
  // Today, in the company's date format (Company Settings) — the Lists sheet's "Downloaded".
  downloadedOn: string;
  // The company's logo (a PNG data URL and its size in pixels) — each room's sheet's top right; none: its name.
  logo: { dataUrl: string; width: number; height: number } | null;
  // The room sheets it starts with ("Room 1"…).
  roomCount: number;
  // The company's staff — the Designer dropdown.
  staff: string[];
  // The company's room names (Company Settings › Rooms) — Project Sections' Section dropdown.
  roomNames: string[];
  thicknesses: string[];
  finishes: string[];
  sheetSizes: string[];
  // The company's default sheet size ("2440 x 1220"), the boards' to start with.
  defaultSheetSize: string;
  // Each one's colour ("#F2D57A") — its rows' in the rooms.
  partTypes: Array<{ name: string; kind: CutlistTemplatePartKind; color?: string }>;
  hardware: CutlistTemplateHardware[];
  // The company's default hardware and its default drawer type — Global Job Selections' to start with.
  defaultHardware: string;
  defaultDrawer: string;
  contractors: string[];
};

export type CutlistTemplateRow = {
  sheetRow: number;
  partType: string;
  board: string;
  name: string;
  height: string;
  width: string;
  depth: string;
  quantity: string;
  clashLong: string;
  clashShort: string;
  grain: string;
  information: string;
  cabinet: string;
  fixedShelves: string;
  fixedDrilling: string;
  adjustableShelves: string;
  adjustableDrilling: string;
  clashBottom: string;
  fullTop: string;
};
// Global Job Selections, as filled in ("" where it wasn't).
export type CutlistTemplateGlobal = Record<GlobalField, string>;
export type CutlistTemplateOrderLine = { name: string; qty: string };
export type CutlistTemplateParsed = {
  global: CutlistTemplateGlobal;
  // Project Sections: each room's name ("Misc: TV Cabinet") and its own drawer type ("Blum · Legrabox"; "" for Global).
  sections: Array<{ name: string; drawerType: string }>;
  boards: CutlistTemplateBoard[];
  order: { hinges: CutlistTemplateOrderLine[]; other: CutlistTemplateOrderLine[]; misc: CutlistTemplateOrderLine[] };
  // roomName: its Room (at the top), or else its sheet's name. drawerType: its section's own ("" for Global).
  rooms: Array<{ sheetName: string; roomName: string; drawerType: string; rows: CutlistTemplateRow[] }>;
  notes: { production: string; contractors: Record<string, string> };
};

type PartField = Exclude<keyof CutlistTemplateRow, "sheetRow">;
const PART_COLUMNS: Array<{ field: PartField; heading: string; width: number; cabinetry?: boolean }> = [
  { field: "partType", heading: "Part Type", width: 18 },
  { field: "board", heading: "Board", width: 30 },
  { field: "name", heading: "Part Name", width: 26 },
  { field: "height", heading: "Height", width: 13 },
  { field: "width", heading: "Width", width: 10 },
  { field: "depth", heading: "Depth", width: 10 },
  { field: "quantity", heading: "Qty", width: 7 },
  { field: "clashLong", heading: "Clash Long", width: 11 },
  { field: "clashShort", heading: "Clash Short", width: 11 },
  { field: "grain", heading: "Grain", width: 9 },
  { field: "information", heading: "Information", width: 32 },
  { field: "cabinet", heading: "Cabinet", width: 10, cabinetry: true },
  { field: "fixedShelves", heading: "Fixed Shelves", width: 10, cabinetry: true },
  { field: "fixedDrilling", heading: "Fixed Drilling", width: 14, cabinetry: true },
  { field: "adjustableShelves", heading: "Adj. Shelves", width: 10, cabinetry: true },
  { field: "adjustableDrilling", heading: "Adj. Drilling", width: 14, cabinetry: true },
  { field: "clashBottom", heading: "Clash Bottom", width: 13, cabinetry: true },
  { field: "fullTop", heading: "Full Top", width: 9, cabinetry: true },
];
// A heading as it's matched: letters only, lower case ("Adj. Shelves" → "adjshelves").
const headingKey = (text: string) => text.toLowerCase().replace(/[^a-z]/g, "");
const PART_FIELD_BY_HEADING: Record<string, PartField> = Object.fromEntries(
  PART_COLUMNS.map((column) => [headingKey(column.heading), column.field]),
);

// ---- The Dashboard's layout (columns: A margin; B–D the left cards; E a gap; F–N the right cards; O–Q hidden workings)
const C = { b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11, l: 12, m: 13, n: 14, boardName: 15, sectionRoom: 16, sectionDrawer: 17 };
const ROW = { topTitle: 2, topFirst: 3, tablesTitle: 9, tablesHead: 10, tablesFirst: 11, orderTitle: 32 };
// Global Job Selections: three label / value pairs across. A pair's label is in `labelColumn` (merged to just before its
// value), its value `valueOffset` columns along.
const GLOBAL_GROUPS = [
  { labelColumn: C.f, labelTo: C.g, valueColumn: C.h, valueTo: C.h },
  { labelColumn: C.i, labelTo: C.j, valueColumn: C.k, valueTo: C.l },
  { labelColumn: C.m, labelTo: C.m, valueColumn: C.n, valueTo: C.n },
] as const;
type GlobalField =
  | "carcassThickness"
  | "panelThickness"
  | "frontsThickness"
  | "footDistanceBack"
  | "topScribers"
  | "baseCabHeight"
  | "tallCabHeight"
  | "footHeight"
  | "hobCentre"
  | "hobSide"
  | "hardware"
  | "drawerType"
  | "hingeType"
  | "handles";
// `column`: a value in a cell of its own (not its group's), beside another on the same row — a field with no label
// of its own sits beside the labelled one on its row (Hob Centre From: its side, then its distance).
const GLOBAL_FIELDS: Array<{ key: GlobalField; label: string; group: 0 | 1 | 2; row: number; column?: number }> = [
  { key: "carcassThickness", label: "Carcass Thickness", group: 0, row: 0 },
  { key: "panelThickness", label: "Panel Thickness", group: 0, row: 1 },
  { key: "frontsThickness", label: "Fronts Thickness", group: 0, row: 2 },
  { key: "footDistanceBack", label: "Foot Distance Back", group: 0, row: 3 },
  { key: "topScribers", label: "Top Scribers", group: 0, row: 4 },
  { key: "baseCabHeight", label: "Base Cab Height", group: 1, row: 0 },
  { key: "tallCabHeight", label: "Tall Cab Height", group: 1, row: 1 },
  { key: "footHeight", label: "Foot Height", group: 1, row: 2 },
  { key: "hobSide", label: "Hob Centre From", group: 1, row: 3, column: C.k },
  { key: "hobCentre", label: "", group: 1, row: 3, column: C.l },
  { key: "hardware", label: "Hardware", group: 2, row: 0 },
  { key: "drawerType", label: "Drawer Type", group: 2, row: 1 },
  { key: "hingeType", label: "Hinge Type", group: 2, row: 2 },
  { key: "handles", label: "Handles", group: 2, row: 3 },
];
const globalCell = (key: GlobalField) => {
  const field = GLOBAL_FIELDS.find((item) => item.key === key)!;
  return { row: ROW.topFirst + field.row, column: field.column ?? GLOBAL_GROUPS[field.group].valueColumn };
};
const PROJECT_DETAILS = ["Project Name", "Client Name", "Designer Name", "Current Date"];
// Board Types & Finishes' columns (Colour and Edging across two each), F–N.
const BOARD_COLUMNS = [
  { heading: "Colour", from: C.f, to: C.g },
  { heading: "Thickness", from: C.h, to: C.h },
  { heading: "Finish", from: C.i, to: C.i },
  { heading: "Sheet Size", from: C.j, to: C.j },
  { heading: "Edging", from: C.k, to: C.l },
  { heading: "Grain", from: C.m, to: C.m },
  { heading: "Lacquer", from: C.n, to: C.n },
] as const;
const boardColumn = (heading: (typeof BOARD_COLUMNS)[number]["heading"]) => BOARD_COLUMNS.find((column) => column.heading === heading)!.from;

// ---- Names shared with the app (the sheet names, drawer type labels and heights it reads back)

// A room's sheet name: Excel's rules (31 characters, none of []:*?/\) — and never one of the template's own sheets.
export function cutlistTemplateSheetBase(room: string): string {
  const cleaned = room.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31).trim() || "Room";
  return NOT_ROOM_SHEETS.includes(cleaned.toLowerCase()) ? `${cleaned} Room` : cleaned;
}
export function cutlistTemplateDrawerLabel(hardware: string, drawer: string): string {
  return [hardware.trim(), drawer.trim()].filter(Boolean).join(" · ");
}
// A Height dropdown option ("A · 140mm") — or the letter alone when it has no size of its own.
function heightOptionText(letter: string, size: string): string {
  const mm = size.trim().replace(/mm$/i, "");
  return mm && mm.toLowerCase() !== letter.toLowerCase() ? `${letter} · ${mm}mm` : letter;
}
// A Height cell's drawer heights back as letters: "A · 140mm" → "A"; "A, B, C" (typed) kept as it is.
export function cutlistTemplateHeightText(text: string): string {
  return text
    .split(",")
    .map((part) => part.split("·")[0].trim())
    .filter(Boolean)
    .join(", ");
}

// A spreadsheet cell's value as text (exceljs): rich text joined, a formula's result, a link's text.
export function spreadsheetCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    if (Array.isArray(item.richText)) {
      return item.richText.map((part) => String((part as Record<string, unknown>)?.text ?? "")).join("").trim();
    }
    if ("result" in item) return typeof item.result === "object" ? "" : String(item.result ?? "").trim();
    if ("text" in item) return String(item.text ?? "").trim();
    return "";
  }
  return String(value).trim();
}

// "Natural Oak 18mm Woodgrain" — as Board Settings names a board.
export function cutlistTemplateBoardLabel(board: Pick<CutlistTemplateBoard, "colour" | "thickness" | "finish">): string {
  const thickness = board.thickness.trim();
  return [board.colour.trim(), thickness ? (/mm$/i.test(thickness) ? thickness : `${thickness}mm`) : "", board.finish.trim()]
    .filter(Boolean)
    .join(" ");
}

// ---- Building it

const COLOURS = {
  heading: "FF334155",
  headingText: "FFFFFFFF",
  cabinetryHeading: "FF7C3AED",
  cabinetryGroup: "FFEDE9FE",
  group: "FFE2E8F0",
  border: "FFCBD5E1",
  cardBorder: "FF94A3B8",
  tableOutline: "FF475569",
  cardTitle: "FFD9DEE5",
  cardTitleText: "FF5B6B7F",
  tableHead: "FF1F2937",
  zebra: "FFF2F4F7",
  muted: "FF64748B",
  sectionFill: "FFF1F5F9",
  greyedFill: "FFF1F5F9",
  greyedText: "FFA0AEC0",
  noteTitle: "FFE0E7FF",
};
const thinBorder = { style: "thin" as const, color: { argb: COLOURS.border } };
const boxBorder = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };
const columnLetter = (column: number) => {
  let out = "";
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
};
const abs = (column: number, row: number) => `$${columnLetter(column)}$${row}`;
const quoteList = (values: string[]) => `"${values.join(",")}"`;
function addValidation(sheet: Worksheet, range: string, validation: DataValidation) {
  (sheet as unknown as { dataValidations: { add: (address: string, v: DataValidation) => void } }).dataValidations.add(
    range,
    validation,
  );
}
// A dropdown that warns about (rather than refuses) anything not in its list — or, not strict, takes anything quietly.
const listValidation = (formula: string, strict = true): DataValidation => ({
  type: "list",
  allowBlank: true,
  formulae: [formula],
  showErrorMessage: strict,
  errorStyle: "warning",
  errorTitle: "Not in the list",
  error: "This isn't one of the options — it'll be imported as written.",
});
// A colour ("#F2D57A", "#ABC") as Excel takes it ("FFF2D57A") — "" if it isn't one.
function argbOf(hex: string | undefined): string {
  const clean = String(hex ?? "").trim().replace(/^#/, "");
  const full = /^[0-9a-f]{3}$/i.test(clean) ? clean.replace(/./g, (c) => c + c) : clean;
  return /^[0-9a-f]{6}$/i.test(full) ? `FF${full.toUpperCase()}` : "";
}
// Text on a colour: black on a light one, near-white on a dark one (the Production tab's own cut-off).
function textArgbOn(hex: string): string {
  const argb = argbOf(hex);
  if (!argb) return "FF000000";
  const [r, g, b] = [2, 4, 6].map((at) => Number.parseInt(argb.slice(at, at + 2), 16));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.62 ? "FF000000" : "FFF8FAFC";
}
// A yes / no cell: a tick box (ticked is yes) — FALSE to start, marked by this number format so addCellCheckboxes can
// make its style one (a format of its own that shows TRUE / FALSE as they are — what an Excel without tick boxes shows).
const CHECKBOX_NUMBER_FORMAT = "0;-0;0;@";
function tickBox(cell: Cell) {
  cell.value = false;
  cell.numFmt = CHECKBOX_NUMBER_FORMAT;
  cell.alignment = { horizontal: "center", vertical: "middle" };
}
function styleHeading(sheet: Worksheet, row: number, from: number, to: number, fill: string) {
  for (let c = from; c <= to; c += 1) {
    const cell = sheet.getCell(row, c);
    cell.font = { bold: true, color: { argb: COLOURS.headingText } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = boxBorder;
  }
}
function sectionTitle(sheet: Worksheet, row: number, text: string, hint: string, toColumn: number) {
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { bold: true, size: 13 };
  for (let c = 1; c <= toColumn; c += 1) sheet.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOURS.sectionFill } };
  if (hint) {
    const hintCell = sheet.getCell(row + 1, 1);
    hintCell.value = hint;
    hintCell.font = { italic: true, size: 9, color: { argb: COLOURS.muted } };
  }
}
// A Dashboard card: its title bar across `from`–`to`, and a border round all of it down to `lastRow`.
function card(sheet: Worksheet, titleRow: number, lastRow: number, from: number, to: number, title: string) {
  sheet.mergeCells(titleRow, from, titleRow, to);
  const head = sheet.getCell(titleRow, from);
  head.value = title;
  head.font = { bold: true, size: 13, color: { argb: COLOURS.cardTitleText } };
  head.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(titleRow).height = 28;
  const edge = { style: "thin" as const, color: { argb: COLOURS.cardBorder } };
  for (let r = titleRow; r <= lastRow; r += 1) {
    for (let c = from; c <= to; c += 1) {
      const cell = sheet.getCell(r, c);
      if (r === titleRow) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOURS.cardTitle } };
      cell.border = {
        ...(cell.border ?? {}),
        ...(r === titleRow || r === titleRow + 1 ? { top: edge } : {}),
        ...(r === lastRow ? { bottom: edge } : {}),
        ...(c === from ? { left: edge } : {}),
        ...(c === to ? { right: edge } : {}),
      };
    }
  }
}
// A card's table headings row.
function tableHead(sheet: Worksheet, row: number, cells: Array<[number, number, string]>, centre = true) {
  for (const [from, to, text] of cells) {
    if (to > from) sheet.mergeCells(row, from, row, to);
    const cell = sheet.getCell(row, from);
    cell.value = text;
    cell.font = { bold: true, size: 10, color: { argb: COLOURS.tableHead } };
    cell.alignment = { horizontal: centre ? "center" : "left", vertical: "middle" };
    for (let c = from; c <= to; c += 1) {
      const each = sheet.getCell(row, c);
      each.border = { ...(each.border ?? {}), bottom: { style: "thin", color: { argb: COLOURS.cardBorder } } };
    }
  }
}
// A card's rows, every second one grey, with lines between its columns.
function zebraRows(sheet: Worksheet, first: number, last: number, from: number, to: number, splits: number[]) {
  for (let r = first; r <= last; r += 1) {
    for (let c = from; c <= to; c += 1) {
      const cell = sheet.getCell(r, c);
      if ((r - first) % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOURS.zebra } };
      if (splits.includes(c)) cell.border = { ...(cell.border ?? {}), right: thinBorder };
    }
  }
}

export async function buildCutlistTemplateWorkbook(input: CutlistTemplateInput): Promise<Blob> {
  const { Workbook: WorkbookClass } = await import("exceljs");
  const workbook: Workbook = new WorkbookClass();
  workbook.creator = "CutSmart";
  workbook.created = new Date();
  // Its dropdowns, board names and drawer counts are formulas — worked out as it opens.
  workbook.calcProperties.fullCalcOnLoad = true;

  const dashboard = workbook.addWorksheet(DASHBOARD_SHEET, { properties: { tabColor: { argb: "FF16A34A" } } });
  const roomSheets = Array.from({ length: Math.max(1, input.roomCount) }, (_, index) =>
    workbook.addWorksheet(`Room ${index + 1}`, { properties: { tabColor: { argb: "FF2563EB" } } }),
  );
  const notesSheet = workbook.addWorksheet(NOTES_SHEET, { properties: { tabColor: { argb: "FFF59E0B" } } });
  const lists = workbook.addWorksheet(LISTS_SHEET, { properties: { tabColor: { argb: "FF94A3B8" } } });

  // ---- Lists: the company's settings the dropdowns use
  [26, 18, 18, 18, 18, 18, 18, 18].forEach((width, index) => (lists.getColumn(index + 1).width = width));
  lists.getCell("A1").value = CUTLIST_TEMPLATE_MARKER;
  lists.getCell("A1").font = { bold: true, size: 15 };
  lists.getCell("A2").value = [input.companyName, `Downloaded ${input.downloadedOn}`].filter(Boolean).join("  ·  ");
  lists.getCell("A2").font = { size: 10, color: { argb: COLOURS.muted } };
  lists.getCell("A3").value = "The company's settings the Dashboard's and rooms' dropdowns use, as they were at download. Leave this sheet as it is.";
  lists.getCell("A3").font = { italic: true, size: 9, color: { argb: COLOURS.muted } };
  let row = 5;
  // A range of the Lists sheet, as a dropdown takes it ("Lists!$A$8:$A$11") — plain cells, not a named range.
  const listRange = (fromColumn: number, fromRow: number, toRow: number, toColumn = fromColumn) =>
    `${LISTS_SHEET}!${abs(fromColumn, fromRow)}:${abs(toColumn, toRow)}`;
  // A list down a column (from `top`) — its range ("" when there's nothing in it).
  const writeColumn = (column: number, top: number, values: string[]) => {
    values.forEach((value, index) => {
      const cell = lists.getCell(top + index, column);
      cell.value = value;
      cell.border = boxBorder;
    });
    return values.length ? listRange(column, top, top + values.length - 1) : "";
  };

  // Part types: each one's kind, and the cabinetry and drawer ones on their own (what greys the rooms' columns out, and
  // gives a drawer row its Height dropdown) — each name in its own colour, its rows' colour in the rooms.
  sectionTitle(lists, row, "Part Types", "Cabinetry ones use the rooms' cabinetry columns, drawer ones get the Height dropdown — and each one's colour is its rows' in the rooms.", 8);
  row += 2;
  ["Part Type", "Kind", "Cabinetry", "Drawers"].forEach((text, index) => (lists.getCell(row, index + 1).value = text));
  styleHeading(lists, row, 1, 4, COLOURS.heading);
  const partTypesRange = writeColumn(1, row + 1, input.partTypes.map((partType) => partType.name));
  writeColumn(2, row + 1, input.partTypes.map((partType) => partType.kind));
  const cabinetryTypesRange = writeColumn(3, row + 1, input.partTypes.filter((partType) => partType.kind === "Cabinetry").map((partType) => partType.name));
  const drawerPartTypesRange = writeColumn(4, row + 1, input.partTypes.filter((partType) => partType.kind === "Drawer").map((partType) => partType.name));
  input.partTypes.forEach((partType, index) => {
    const colour = argbOf(partType.color);
    if (!colour) return;
    const cell = lists.getCell(row + 1 + index, 1);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colour } };
    cell.font = { color: { argb: textArgbOn(partType.color ?? "") } };
  });
  row += 1 + Math.max(1, input.partTypes.length) + 1;

  // Drawer types (every hardware's), each with its heights — a room's drawer rows' Height dropdown lists its own.
  sectionTitle(lists, row, "Drawer Types", "Each drawer type and its heights — a room's drawer rows' Height dropdown lists its drawer type's.", 8);
  row += 2;
  const drawerTypes = input.hardware.flatMap((hardware) =>
    hardware.drawers
      .filter((drawer) => drawer.heights.length)
      .map((drawer) => ({ label: cutlistTemplateDrawerLabel(hardware.name, drawer.name), heights: drawer.heights })),
  );
  const drawerLabelRow = row;
  const mostDrawerHeights = Math.max(1, ...drawerTypes.map((drawer) => drawer.heights.length));
  drawerTypes.forEach((drawer, index) => {
    lists.getCell(drawerLabelRow, index + 1).value = drawer.label;
    writeColumn(index + 1, drawerLabelRow + 1, drawer.heights.map((height) => heightOptionText(height.letter, height.size)));
  });
  const drawerLabelsRange = drawerTypes.length ? listRange(1, drawerLabelRow, drawerLabelRow, drawerTypes.length) : "";
  const drawerHeightsBlock = drawerTypes.length ? listRange(1, drawerLabelRow + 1, drawerLabelRow + mostDrawerHeights, drawerTypes.length) : "";
  if (drawerTypes.length) {
    styleHeading(lists, drawerLabelRow, 1, drawerTypes.length, COLOURS.heading);
  } else {
    lists.getCell(drawerLabelRow, 1).value = "No drawer types in Company Settings › Hardware.";
    lists.getCell(drawerLabelRow, 1).font = { italic: true, color: { argb: COLOURS.muted } };
  }
  row = drawerLabelRow + 1 + mostDrawerHeights + 1;

  // Hardware: each brand's drawer types, hinges and other items (Global Job Selections' and the Order Section's) — its
  // names along the top (`names`), each one's list below its name (`block`).
  const hardwareTable = (title: string, hint: string, pick: (hardware: CutlistTemplateHardware) => string[]) => {
    sectionTitle(lists, row, title, hint, 8);
    row += 2;
    const top = row;
    const longest = Math.max(1, ...input.hardware.map((hardware) => pick(hardware).length));
    input.hardware.forEach((hardware, index) => {
      lists.getCell(top, index + 1).value = hardware.name;
      writeColumn(index + 1, top + 1, pick(hardware));
    });
    if (input.hardware.length) styleHeading(lists, top, 1, input.hardware.length, COLOURS.heading);
    row = top + 1 + longest + 1;
    return {
      names: input.hardware.length ? listRange(1, top, top, input.hardware.length) : "",
      block: input.hardware.length ? listRange(1, top + 1, top + longest, input.hardware.length) : "",
      longest,
    };
  };
  const hardwareDrawers = hardwareTable("Hardware · Drawer Types", "Global Job Selections' Drawer Type follows its Hardware.", (hardware) => hardware.drawers.map((drawer) => drawer.name));
  const hardwareHinges = hardwareTable("Hardware · Hinges", "The Order Section's Hinge Type follows Global Job Selections' Hardware.", (hardware) => hardware.hinges);
  const hardwareOther = hardwareTable("Hardware · Other", "The Order Section's Other items follow Global Job Selections' Hardware.", (hardware) => hardware.other);
  const hardwareNamesRange = hardwareDrawers.names;

  sectionTitle(lists, row, "Company Settings", "Board options, staff, rooms, and the sections' drawer types.", 8);
  row += 2;
  const sectionDrawerTypes = [GLOBAL_DRAWER_TYPE, ...drawerTypes.map((drawer) => drawer.label)];
  const companyLists: Array<[string, string[]]> = [
    ["Thicknesses", input.thicknesses],
    ["Finishes", input.finishes],
    ["Sheet Sizes", input.sheetSizes],
    ["Staff", input.staff],
    ["Rooms", input.roomNames],
    ["Section Drawer Types", sectionDrawerTypes],
  ];
  const companyRange: Record<string, string> = {};
  companyLists.forEach(([heading, values], index) => {
    lists.getCell(row, index + 1).value = heading;
    companyRange[heading] = writeColumn(index + 1, row + 1, values);
  });
  styleHeading(lists, row, 1, companyLists.length, COLOURS.heading);

  // Worked out (hidden, beside the lists): the Dashboard's Hardware's own drawer types, hinges and other items, one
  // under another — the lists its Drawer Type and the Order Section's dropdowns show (each only as long as it is).
  const hardwareRef = abs(globalCell("hardware").column, globalCell("hardware").row);
  const pickedColumn = Math.max(8, drawerTypes.length, input.hardware.length) + 3;
  const pickedList = (offset: number, heading: string, table: ReturnType<typeof hardwareTable>) => {
    const column = pickedColumn + offset;
    lists.getColumn(column).hidden = true;
    lists.getCell(5, column).value = heading;
    if (!table.names) return "";
    for (let k = 1; k <= table.longest; k += 1) {
      lists.getCell(5 + k, column).value = {
        formula: `IFERROR(INDEX(${table.block},${k},MATCH(${DASHBOARD_SHEET}!${hardwareRef},${table.names},0))&"","")`,
        result: "",
      };
    }
    return `OFFSET(${LISTS_SHEET}!${abs(column, 6)},0,0,MAX(1,COUNTIF(${LISTS_SHEET}!${abs(column, 6)}:${abs(column, 5 + table.longest)},"?*")),1)`;
  };
  const pickedDrawersList = pickedList(0, "Its drawer types", hardwareDrawers);
  const pickedHingesList = pickedList(1, "Its hinges", hardwareHinges);
  const pickedOtherList = pickedList(2, "Its other items", hardwareOther);
  lists.views = [{ state: "normal", showGridLines: false }];

  // ---- Dashboard
  [2, 17, 15, 17, 2, 18, 11, 13, 13, 12, 9, 9, 15, 15, 30, 30, 30].forEach((width, index) => (dashboard.getColumn(index + 1).width = width));
  for (const hidden of [C.boardName, C.sectionRoom, C.sectionDrawer]) dashboard.getColumn(hidden).hidden = true;
  dashboard.getRow(1).height = 8;
  const label = (r: number, from: number, to: number, text: string, align: "left" | "right" = "right") => {
    if (to > from) dashboard.mergeCells(r, from, r, to);
    const cell = dashboard.getCell(r, from);
    cell.value = text;
    cell.font = { bold: true, size: 10, color: { argb: COLOURS.tableHead } };
    cell.alignment = { horizontal: align, vertical: "middle", indent: align === "right" ? 1 : 0 };
  };
  const value = (r: number, from: number, to: number) => {
    if (to > from) dashboard.mergeCells(r, from, r, to);
    const cell = dashboard.getCell(r, from);
    cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    cell.font = { size: 10 };
    return cell;
  };
  const topLast = ROW.topFirst + 4;

  // Project Details
  PROJECT_DETAILS.forEach((text, index) => {
    const r = ROW.topFirst + index;
    label(r, C.b, C.b, text);
    const cell = value(r, C.c, C.d);
    // (Typed in — a date entered shows as one.)
    if (text === "Current Date") cell.numFmt = "dd-mm-yyyy";
  });
  if (companyRange.Staff) addValidation(dashboard, `${columnLetter(C.c)}${ROW.topFirst + 2}`, listValidation(companyRange.Staff, false));
  zebraRows(dashboard, ROW.topFirst, topLast, C.b, C.d, []);
  card(dashboard, ROW.topTitle, topLast, C.b, C.d, "📄  PROJECT DETAILS");

  // Global Job Selections
  const defaultHardware = input.hardware.find((hardware) => hardware.name === input.defaultHardware) ?? input.hardware[0];
  for (const field of GLOBAL_FIELDS) {
    const group = GLOBAL_GROUPS[field.group];
    const r = ROW.topFirst + field.row;
    if (field.label) label(r, group.labelColumn, group.labelTo, field.label);
    const cell = value(r, field.column ?? group.valueColumn, field.column ?? group.valueTo);
    const address = `${columnLetter(field.column ?? group.valueColumn)}${r}`;
    if (["carcassThickness", "panelThickness", "frontsThickness"].includes(field.key) && companyRange.Thicknesses) {
      addValidation(dashboard, address, listValidation(companyRange.Thicknesses));
    }
    if (field.key === "topScribers") tickBox(cell);
    if (field.key === "hobSide") addValidation(dashboard, address, listValidation(quoteList(["RH", "LH"])));
    if (field.key === "handles") addValidation(dashboard, address, listValidation(quoteList(["Front Fixed", "Profile"])));
    // Hinge Type: whose hinges (a hardware brand, as the Production tab has it).
    if ((field.key === "hardware" || field.key === "hingeType") && hardwareNamesRange) {
      addValidation(dashboard, address, listValidation(hardwareNamesRange));
      cell.value = defaultHardware?.name ?? "";
    }
    if (field.key === "drawerType" && pickedDrawersList) {
      addValidation(dashboard, address, listValidation(pickedDrawersList));
      const drawer = defaultHardware?.drawers.find((item) => item.name === input.defaultDrawer) ?? defaultHardware?.drawers[0];
      cell.value = drawer?.name ?? "";
    }
  }
  zebraRows(dashboard, ROW.topFirst, topLast, C.f, C.n, [C.h, C.l]);
  // A line between Hob Centre From's side and its distance (that row's K and L are cells of their own).
  const hobSide = globalCell("hobSide");
  const hobSideCell = dashboard.getCell(hobSide.row, hobSide.column);
  hobSideCell.border = { ...(hobSideCell.border ?? {}), right: thinBorder };
  card(dashboard, ROW.topTitle, topLast, C.f, C.n, "🌐  GLOBAL JOB SELECTIONS");
  // The Dashboard's drawer type, as a label ("Blum · Legrabox") — a Global section's, and so its rooms'.
  const drawerRef = abs(globalCell("drawerType").column, globalCell("drawerType").row);
  const globalDrawerLabelFormula = `IF(OR(${hardwareRef}="",${drawerRef}=""),"",${hardwareRef}&" · "&${drawerRef})`;
  const defaultDrawerLabel = defaultHardware
    ? cutlistTemplateDrawerLabel(defaultHardware.name, String(dashboard.getCell(globalCell("drawerType").row, globalCell("drawerType").column).value ?? ""))
    : "";

  // Project Sections: a company room, a name after it ("Misc" + "TV Cabinet" → "Misc: TV Cabinet"), its drawer type.
  const tablesLast = ROW.tablesFirst + DASHBOARD_TABLE_ROWS - 1;
  tableHead(dashboard, ROW.tablesHead, [
    [C.b, C.b, "Section"],
    [C.c, C.c, "Name"],
    [C.d, C.d, "Drawer Type"],
  ]);
  for (let r = ROW.tablesFirst; r <= tablesLast; r += 1) {
    const roomFormula = `IF(AND(TRIM(B${r})="",TRIM(C${r})=""),"",IF(TRIM(B${r})="",TRIM(C${r}),IF(TRIM(C${r})="",TRIM(B${r}),TRIM(B${r})&": "&TRIM(C${r}))))`;
    dashboard.getCell(r, C.sectionRoom).value = { formula: roomFormula, result: "" };
    dashboard.getCell(r, C.sectionDrawer).value = {
      formula: `IF(${columnLetter(C.sectionRoom)}${r}="","",IF(OR(TRIM(D${r})="",TRIM(D${r})="${GLOBAL_DRAWER_TYPE}"),${globalDrawerLabelFormula},D${r}))`,
      result: "",
    };
    for (const column of [C.b, C.c, C.d]) dashboard.getCell(r, column).font = { size: 10 };
  }
  if (companyRange.Rooms) addValidation(dashboard, `B${ROW.tablesFirst}:B${tablesLast}`, listValidation(companyRange.Rooms, false));
  addValidation(dashboard, `D${ROW.tablesFirst}:D${tablesLast}`, listValidation(companyRange["Section Drawer Types"]));
  zebraRows(dashboard, ROW.tablesFirst, tablesLast, C.b, C.d, [C.b, C.c]);
  card(dashboard, ROW.tablesTitle, tablesLast, C.b, C.d, "📌  PROJECT SECTIONS");
  const sectionRoomRange = `${DASHBOARD_SHEET}!$${columnLetter(C.sectionRoom)}$${ROW.tablesFirst}:$${columnLetter(C.sectionRoom)}$${tablesLast}`;
  const sectionDrawerRange = `${DASHBOARD_SHEET}!$${columnLetter(C.sectionDrawer)}$${ROW.tablesFirst}:$${columnLetter(C.sectionDrawer)}$${tablesLast}`;

  // Board Types & Finishes (BOARD_ROWS of them) — each one's name worked out (hidden), for the rooms' Board dropdowns.
  const boardsLast = ROW.tablesFirst + BOARD_ROWS - 1;
  tableHead(
    dashboard,
    ROW.tablesHead,
    BOARD_COLUMNS.map((column) => [column.from, column.to, column.heading] as [number, number, string]),
  );
  const colour = columnLetter(boardColumn("Colour"));
  const thickness = columnLetter(boardColumn("Thickness"));
  const finish = columnLetter(boardColumn("Finish"));
  const boardRange = (heading: (typeof BOARD_COLUMNS)[number]["heading"]) =>
    `${columnLetter(boardColumn(heading))}${ROW.tablesFirst}:${columnLetter(boardColumn(heading))}${boardsLast}`;
  for (let r = ROW.tablesFirst; r <= boardsLast; r += 1) {
    for (const column of BOARD_COLUMNS) if (column.to > column.from) dashboard.mergeCells(r, column.from, r, column.to);
    dashboard.getCell(r, boardColumn("Sheet Size")).value = input.defaultSheetSize;
    dashboard.getCell(r, boardColumn("Edging")).value = "Matching";
    for (let column = C.f; column <= C.n; column += 1) dashboard.getCell(r, column).font = { size: 10 };
    dashboard.getCell(r, C.boardName).value = {
      formula: `IF(TRIM(${colour}${r})="","",TRIM(TRIM(${colour}${r})&" "&IF(TRIM(${thickness}${r})="","",IF(RIGHT(LOWER(TRIM(${thickness}${r})),2)="mm",TRIM(${thickness}${r}),TRIM(${thickness}${r})&"mm"))&" "&TRIM(${finish}${r})))`,
      result: "",
    };
  }
  if (companyRange.Thicknesses) addValidation(dashboard, boardRange("Thickness"), listValidation(companyRange.Thicknesses));
  if (companyRange.Finishes) addValidation(dashboard, boardRange("Finish"), listValidation(companyRange.Finishes));
  if (companyRange["Sheet Sizes"]) addValidation(dashboard, boardRange("Sheet Size"), listValidation(companyRange["Sheet Sizes"]));
  zebraRows(dashboard, ROW.tablesFirst, boardsLast, C.f, C.n, BOARD_COLUMNS.slice(0, -1).map((column) => column.to));
  // Grain / Lacquer: tick boxes (ticked is yes) — after the zebra, so each keeps its row's shade.
  for (let r = ROW.tablesFirst; r <= boardsLast; r += 1) {
    for (const heading of ["Grain", "Lacquer"] as const) tickBox(dashboard.getCell(r, boardColumn(heading)));
  }
  card(dashboard, ROW.tablesTitle, boardsLast, C.f, C.n, "📁  BOARD TYPES & FINISHES");
  const boardNameColumn = columnLetter(C.boardName);
  const boardNamesList = `OFFSET(${DASHBOARD_SHEET}!$${boardNameColumn}$${ROW.tablesFirst},0,0,MAX(1,COUNTIF(${DASHBOARD_SHEET}!$${boardNameColumn}$${ROW.tablesFirst}:$${boardNameColumn}$${boardsLast},"?*")),1)`;

  // Order Section: hinges, other items and misc (drawers are worked out from the cutlist once it's imported).
  const orderRows = ORDER_ROWS;
  const orderGroupRow = ROW.orderTitle + 1;
  const orderHeadRow = ROW.orderTitle + 2;
  const orderFirst = ROW.orderTitle + 3;
  const orderLast = orderFirst + orderRows - 1;
  const groupHead = (from: number, to: number, text: string) => {
    dashboard.mergeCells(orderGroupRow, from, orderGroupRow, to);
    const cell = dashboard.getCell(orderGroupRow, from);
    cell.value = text;
    cell.font = { bold: true, size: 11, color: { argb: COLOURS.tableHead } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    for (let c = from; c <= to; c += 1) {
      dashboard.getCell(orderGroupRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOURS.sectionFill } };
    }
  };
  // Three tables side by side, about a third each, each outlined in a darker line: Hinges B–D, Other E–I, Misc J–N.
  const orderTables = [
    { from: C.b, nameTo: C.c, qty: C.d, title: "Hinges", heading: "Hinge Type" },
    { from: C.e, nameTo: C.h, qty: C.i, title: "Other", heading: "Item" },
    { from: C.j, nameTo: C.m, qty: C.n, title: "Misc", heading: "Part Name" },
  ];
  for (const table of orderTables) groupHead(table.from, table.qty, table.title);
  tableHead(
    dashboard,
    orderHeadRow,
    orderTables.flatMap((table) => [
      [table.from, table.nameTo, table.heading] as [number, number, string],
      [table.qty, table.qty, "Quantity"] as [number, number, string],
    ]),
  );
  for (let r = orderFirst; r <= orderLast; r += 1) {
    for (const table of orderTables) if (table.nameTo > table.from) dashboard.mergeCells(r, table.from, r, table.nameTo);
    for (let column = C.b; column <= C.n; column += 1) dashboard.getCell(r, column).font = { size: 10 };
    for (const table of orderTables) dashboard.getCell(r, table.qty).alignment = { horizontal: "center" };
  }
  {
    const [hinges, other] = orderTables;
    // The Dashboard's Hardware's own hinges and other items.
    if (pickedHingesList) addValidation(dashboard, `${columnLetter(hinges.from)}${orderFirst}:${columnLetter(hinges.from)}${orderLast}`, listValidation(pickedHingesList));
    if (pickedOtherList) addValidation(dashboard, `${columnLetter(other.from)}${orderFirst}:${columnLetter(other.from)}${orderLast}`, listValidation(pickedOtherList));
  }
  zebraRows(dashboard, orderFirst, orderLast, C.b, C.n, orderTables.map((table) => table.nameTo));
  card(dashboard, ROW.orderTitle, orderLast, C.b, C.n, "💼  ORDER SECTION");
  // Each table outlined (after the card's own border, so its edges are the darker line too).
  const tableEdge = { style: "thin" as const, color: { argb: COLOURS.tableOutline } };
  for (const table of orderTables) {
    for (let r = orderGroupRow; r <= orderLast; r += 1) {
      for (let c = table.from; c <= table.qty; c += 1) {
        const cell = dashboard.getCell(r, c);
        cell.border = {
          ...(cell.border ?? {}),
          ...(r === orderGroupRow ? { top: tableEdge } : {}),
          ...(r === orderLast ? { bottom: tableEdge } : {}),
          ...(c === table.from ? { left: tableEdge } : {}),
          ...(c === table.qty ? { right: tableEdge } : {}),
        };
      }
    }
  }
  dashboard.views = [{ state: "normal", showGridLines: false }];

  // ---- A sheet per room
  const lastColumn = PART_COLUMNS.length;
  const projectNameRef = `${DASHBOARD_SHEET}!${abs(C.c, ROW.topFirst)}`;
  // The company's logo, top right of each room's sheet (M1:R4), fitted, right-aligned and centred up and down.
  const logoFrom = 13;
  const logoImage = input.logo ? workbook.addImage({ base64: input.logo.dataUrl, extension: "png" }) : null;
  const headerRowHeights = [22, 22, 10, 22];
  const dashboardDrawerLabel = globalDrawerLabelFormula
    .split(hardwareRef)
    .join(`${DASHBOARD_SHEET}!${hardwareRef}`)
    .split(drawerRef)
    .join(`${DASHBOARD_SHEET}!${drawerRef}`);
  const sectionNamesList = `OFFSET(${DASHBOARD_SHEET}!$${columnLetter(C.sectionRoom)}$${ROW.tablesFirst},0,0,MAX(1,COUNTIF(${sectionRoomRange},"?*")),1)`;
  const partsFirst = 8;
  const partsLast = partsFirst + TEMPLATE_PART_ROWS - 1;
  // Hidden on each room's sheet: the drawer type its drawers are on; that drawer type's heights, one under another (its
  // drawer rows' Height dropdown); and an empty cell (the "dropdown" of every other row — nothing in it).
  const effectiveDrawerColumn = PART_COLUMNS.length + 2;
  const heightsColumn = PART_COLUMNS.length + 3;
  const emptyColumn = PART_COLUMNS.length + 4;
  // Each part type's colour across its rows (as the Production tab's cutlist entry has them) — text dark or light to
  // suit it.
  const colouredPartTypes = input.partTypes.filter((partType) => argbOf(partType.color));
  for (const sheet of roomSheets) {
    PART_COLUMNS.forEach((column, index) => (sheet.getColumn(index + 1).width = column.width));
    for (const hidden of [effectiveDrawerColumn, heightsColumn, emptyColumn]) sheet.getColumn(hidden).hidden = true;
    // Along the top: the project and room on the left, the company and its designer on the right.
    const field = (r: number, labelColumn: number, from: number, to: number, text: string, align: "left" | "right", cellValue: unknown = "") => {
      const labelCell = sheet.getCell(r, labelColumn);
      labelCell.value = text;
      labelCell.font = { bold: true, size: 10, color: { argb: COLOURS.muted } };
      labelCell.alignment = { horizontal: align === "right" ? "right" : "left", vertical: "middle" };
      sheet.mergeCells(r, from, r, to);
      const cell = sheet.getCell(r, from);
      cell.value = cellValue as never;
      cell.font = { bold: true, size: 12 };
      cell.alignment = { horizontal: align, vertical: "middle" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOURS.sectionFill } };
      cell.border = boxBorder;
      sheet.getRow(r).height = 22;
    };
    field(1, 1, 2, 4, "Project", "left", { formula: `IF(${projectNameRef}="","",${projectNameRef})`, result: "" });
    field(2, 1, 2, 4, "Room", "left");
    headerRowHeights.forEach((height, index) => (sheet.getRow(index + 1).height = height));
    sheet.mergeCells(1, logoFrom, headerRowHeights.length, lastColumn);
    if (input.logo && logoImage !== null) {
      // Excel's sizes in pixels: a column's width (characters) and a row's height (points).
      const columnPx = (column: number) => Math.round(PART_COLUMNS[column - 1].width * 7 + 5);
      const rowPx = (height: number) => Math.round((height * 96) / 72);
      let areaWidth = 0;
      for (let c = logoFrom; c <= lastColumn; c += 1) areaWidth += columnPx(c);
      const areaHeight = headerRowHeights.reduce((sum, height) => sum + rowPx(height), 0);
      const inset = 6;
      const ratio = input.logo.width / Math.max(1, input.logo.height);
      let drawWidth = areaWidth - inset * 2;
      let drawHeight = drawWidth / ratio;
      if (drawHeight > areaHeight - inset * 2) {
        drawHeight = areaHeight - inset * 2;
        drawWidth = drawHeight * ratio;
      }
      // Its top left, in columns / rows from the sheet's (fractions of the one it lands in).
      let left = Math.max(inset, areaWidth - drawWidth - inset);
      let colAt = logoFrom - 1;
      for (let c = logoFrom; c <= lastColumn && left > columnPx(c); c += 1) {
        left -= columnPx(c);
        colAt += 1;
      }
      let top = (areaHeight - drawHeight) / 2;
      let rowAt = 0;
      for (const height of headerRowHeights) {
        if (top <= rowPx(height)) break;
        top -= rowPx(height);
        rowAt += 1;
      }
      sheet.addImage(logoImage, {
        tl: { col: colAt + left / columnPx(colAt + 1), row: rowAt + top / rowPx(headerRowHeights[rowAt] ?? 15) },
        ext: { width: Math.round(drawWidth), height: Math.round(drawHeight) },
        editAs: "oneCell",
      });
    } else {
      const name = sheet.getCell(1, logoFrom);
      name.value = input.companyName;
      name.font = { bold: true, size: 18, color: { argb: COLOURS.heading } };
      name.alignment = { horizontal: "right", vertical: "middle" };
    }
    // Its Room: one of the Dashboard's Project Sections (or typed in).
    addValidation(sheet, "B2", listValidation(sectionNamesList, false));

    // Its drawer type: picked from the drawer types — left blank, its section's own (no Room picked, or one that isn't a
    // section: the Dashboard's).
    const drawerRow = 4;
    const drawerLabel = sheet.getCell(drawerRow, 1);
    drawerLabel.value = "Drawer Type";
    drawerLabel.font = { bold: true };
    drawerLabel.alignment = { vertical: "middle" };
    sheet.mergeCells(drawerRow, 2, drawerRow, 3);
    const drawerCell = sheet.getCell(drawerRow, 2);
    drawerCell.border = boxBorder;
    drawerCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOURS.sectionFill } };
    if (drawerLabelsRange) addValidation(sheet, `B${drawerRow}`, listValidation(drawerLabelsRange));
    const effectiveDrawer = sheet.getCell(drawerRow, effectiveDrawerColumn);
    effectiveDrawer.value = {
      formula: `IF(TRIM($B$${drawerRow})<>"",$B$${drawerRow},IF(TRIM($B$2)="",${dashboardDrawerLabel},IFERROR(INDEX(${sectionDrawerRange},MATCH(TRIM($B$2),${sectionRoomRange},0)),${dashboardDrawerLabel})))`,
      result: defaultDrawerLabel,
    };
    const effectiveDrawerRef = abs(effectiveDrawerColumn, drawerRow);
    // That drawer type's heights ("A · 140mm"), one under another.
    if (drawerTypes.length) {
      for (let k = 1; k <= mostDrawerHeights; k += 1) {
        sheet.getCell(partsFirst + k - 1, heightsColumn).value = {
          formula: `IFERROR(INDEX(${drawerHeightsBlock},${k},MATCH(${effectiveDrawerRef},${drawerLabelsRange},0))&"","")`,
          result: "",
        };
      }
    }

    // The columns, grouped: the parts', then the cabinetry-only ones.
    const groupRow = drawerRow + 2;
    const headingRow = groupRow + 1;
    const firstCabinetryColumn = PART_COLUMNS.findIndex((column) => column.cabinetry) + 1;
    sheet.mergeCells(groupRow, 1, groupRow, firstCabinetryColumn - 1);
    sheet.getCell(groupRow, 1).value = "Parts";
    sheet.mergeCells(groupRow, firstCabinetryColumn, groupRow, lastColumn);
    sheet.getCell(groupRow, firstCabinetryColumn).value = "Cabinetry (cabinetry part types only)";
    for (let c = 1; c <= lastColumn; c += 1) {
      const cell = sheet.getCell(groupRow, c);
      const cabinetry = c >= firstCabinetryColumn;
      cell.font = { bold: true, size: 10, color: { argb: cabinetry ? COLOURS.cabinetryHeading : COLOURS.heading } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cabinetry ? COLOURS.cabinetryGroup : COLOURS.group } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = boxBorder;
    }
    PART_COLUMNS.forEach((column, index) => (sheet.getCell(headingRow, index + 1).value = column.heading));
    styleHeading(sheet, headingRow, 1, firstCabinetryColumn - 1, COLOURS.heading);
    styleHeading(sheet, headingRow, firstCabinetryColumn, lastColumn, COLOURS.cabinetryHeading);
    sheet.getRow(headingRow).height = 20;

    const col = (field: PartField) => columnLetter(PART_COLUMNS.findIndex((column) => column.field === field) + 1);
    const range = (field: PartField) => `${col(field)}${partsFirst}:${col(field)}${partsLast}`;
    const fullTopColumn = PART_COLUMNS.findIndex((column) => column.field === "fullTop") + 1;
    for (let rr = partsFirst; rr <= partsLast; rr += 1) {
      for (let c = 1; c <= lastColumn; c += 1) sheet.getCell(rr, c).border = boxBorder;
      // Full Top: a tick box (ticked is yes).
      tickBox(sheet.getCell(rr, fullTopColumn));
    }
    if (partTypesRange) addValidation(sheet, range("partType"), listValidation(partTypesRange));
    addValidation(sheet, range("board"), listValidation(boardNamesList));
    // Height: a dropdown of its drawer type's heights on a drawer part type's row — on any other, nothing in it (a size
    // in mm typed in as it is).
    const typeCell = `$${col("partType")}${partsFirst}`;
    if (drawerTypes.length && drawerPartTypesRange) {
      const heightsTop = abs(heightsColumn, partsFirst);
      const heightsAll = `${heightsTop}:${abs(heightsColumn, partsFirst + mostDrawerHeights - 1)}`;
      addValidation(
        sheet,
        range("height"),
        listValidation(
          `IF(COUNTIF(${drawerPartTypesRange},${typeCell})>0,OFFSET(${heightsTop},0,0,MAX(1,COUNTIF(${heightsAll},"?*")),1),${abs(emptyColumn, partsFirst)})`,
          false,
        ),
      );
    }
    addValidation(sheet, range("clashLong"), listValidation(quoteList(["1L", "2L"])));
    addValidation(sheet, range("clashShort"), listValidation(quoteList(["1S", "2S"])));
    addValidation(sheet, range("grain"), listValidation(quoteList(["Long", "Short"])));
    addValidation(sheet, range("cabinet"), listValidation(quoteList(["Base", "Wall"])));
    addValidation(sheet, range("fixedDrilling"), listValidation(quoteList(["No", "Even Spacing", "Centre"])));
    addValidation(sheet, range("adjustableDrilling"), listValidation(quoteList(["No", "Even Spacing", "Centre"])));
    addValidation(sheet, range("clashBottom"), listValidation(quoteList(["Bottom", "Top/Bottom"])));

    // Greyed out where they don't apply (the cabinetry columns for other part types, clashing for cabinetry) — over each
    // part type's colour across its row.
    const greyed = {
      fill: { type: "pattern" as const, pattern: "solid" as const, bgColor: { argb: COLOURS.greyedFill } },
      font: { color: { argb: COLOURS.greyedText } },
    };
    let priority = 1;
    if (cabinetryTypesRange) {
      const isCabinetry = `COUNTIF(${cabinetryTypesRange},${typeCell})>0`;
      sheet.addConditionalFormatting({
        ref: `${columnLetter(firstCabinetryColumn)}${partsFirst}:${columnLetter(lastColumn)}${partsLast}`,
        rules: [{ type: "expression", priority: priority++, formulae: [`AND(${typeCell}<>"",NOT(${isCabinetry}))`], style: greyed }],
      });
      sheet.addConditionalFormatting({
        ref: `${col("clashLong")}${partsFirst}:${col("clashShort")}${partsLast}`,
        rules: [{ type: "expression", priority: priority++, formulae: [isCabinetry], style: greyed }],
      });
    } else if (input.partTypes.length) {
      sheet.addConditionalFormatting({
        ref: `${columnLetter(firstCabinetryColumn)}${partsFirst}:${columnLetter(lastColumn)}${partsLast}`,
        rules: [{ type: "expression", priority: priority++, formulae: [`${typeCell}<>""`], style: greyed }],
      });
    }
    if (colouredPartTypes.length) {
      sheet.addConditionalFormatting({
        ref: `A${partsFirst}:${columnLetter(lastColumn)}${partsLast}`,
        rules: colouredPartTypes.map((partType) => ({
          type: "expression" as const,
          priority: priority++,
          formulae: [`${typeCell}="${partType.name.replace(/"/g, '""')}"`],
          style: {
            fill: { type: "pattern" as const, pattern: "solid" as const, bgColor: { argb: argbOf(partType.color) } },
            font: { color: { argb: textArgbOn(partType.color ?? "") } },
          },
        })),
      });
    }
    sheet.views = [{ state: "frozen", ySplit: headingRow, xSplit: 0, showGridLines: false }];
  }

  // ---- Notes: a box for the project's notes, then one per contractor — each one's title above it.
  notesSheet.getColumn(1).width = 16;
  for (let c = 2; c <= 8; c += 1) notesSheet.getColumn(c).width = 14;
  notesSheet.getColumn(NOTE_KEY_COLUMN).hidden = true;
  notesSheet.getCell("A1").value = "Notes";
  notesSheet.getCell("A1").font = { bold: true, size: 15 };
  notesSheet.getCell("A2").value = "Anything written in a box is added to that one's notes in the project on import.";
  notesSheet.getCell("A2").font = { italic: true, size: 9, color: { argb: COLOURS.muted } };
  let noteRow = 4;
  const noteBoxes = [
    { key: "notes", title: "Notes" },
    ...input.contractors.map((name) => ({ key: `contractor:${name}`, title: name })),
  ];
  for (const box of noteBoxes) {
    notesSheet.mergeCells(noteRow, 1, noteRow, 8);
    const title = notesSheet.getCell(noteRow, 1);
    title.value = box.title;
    title.font = { bold: true, size: 12 };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOURS.noteTitle } };
    title.border = boxBorder;
    notesSheet.getCell(noteRow, NOTE_KEY_COLUMN).value = box.key;
    notesSheet.mergeCells(noteRow + 1, 1, noteRow + NOTE_BOX_ROWS, 8);
    const body = notesSheet.getCell(noteRow + 1, 1);
    body.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    body.border = boxBorder;
    noteRow += NOTE_BOX_ROWS + 2;
  }
  notesSheet.views = [{ state: "normal", showGridLines: false }];

  const buffer = await workbook.xlsx.writeBuffer();
  const withTickBoxes = await addCellCheckboxes(buffer as ArrayBuffer);
  return new Blob([withTickBoxes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// Excel's cell tick boxes (Insert › Checkbox) — which exceljs can't write: each yes / no cell is written with
// CHECKBOX_NUMBER_FORMAT (tickBox), and here every cell style with that format gets the tick box's extension, with the
// feature property bag part it points to (as Excel itself — and XlsxWriter — write them). Excel without tick boxes
// shows the cell's TRUE / FALSE.
async function addCellCheckboxes(buffer: ArrayBuffer): Promise<Uint8Array | ArrayBuffer> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const stylesFile = zip.file("xl/styles.xml");
  const typesFile = zip.file("[Content_Types].xml");
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!stylesFile || !typesFile || !relsFile) return buffer;
  let styles = await stylesFile.async("string");
  const unescape = (text: string) => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const formatId = Array.from(styles.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"\s*\/>/g)).find(
    (match) => unescape(match[2]) === CHECKBOX_NUMBER_FORMAT,
  )?.[1];
  const xfsMatch = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!formatId || !xfsMatch || xfsMatch.index === undefined) return buffer;
  const extension =
    '<extLst><ext uri="{C7286773-470A-42A8-94C5-96B5CB345126}" xmlns:xfpb="http://schemas.microsoft.com/office/spreadsheetml/2022/featurepropertybag"><xfpb:xfComplement i="0"/></ext></extLst>';
  const xfs = xfsMatch[1].replace(/<xf\b([^>]*?)(\/>|>([\s\S]*?)<\/xf>)/g, (whole, attributes: string, _end: string, inner?: string) => {
    if (!new RegExp(`\\bnumFmtId="${formatId}"`).test(attributes)) return whole;
    return `<xf${attributes}>${inner ?? ""}${extension}</xf>`;
  });
  const xfsStart = xfsMatch.index + xfsMatch[0].indexOf(">") + 1;
  styles = styles.slice(0, xfsStart) + xfs + styles.slice(xfsStart + xfsMatch[1].length);
  zip.file("xl/styles.xml", styles, { createFolders: false });
  zip.file(
    "xl/featurePropertyBag/featurePropertyBag.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<FeaturePropertyBags xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/featurepropertybag"><bag type="Checkbox"/><bag type="XFControls"><bagId k="CellControl">0</bagId></bag><bag type="XFComplement"><bagId k="XFControls">1</bagId></bag><bag type="XFComplements" extRef="XFComplementsMapperExtRef"><a k="MappedFeaturePropertyBags"><bagId>2</bagId></a></bag></FeaturePropertyBags>',
    { createFolders: false },
  );
  const types = await typesFile.async("string");
  if (!types.includes("featurepropertybag")) {
    zip.file(
      "[Content_Types].xml",
      types.replace(
        "</Types>",
        '<Override PartName="/xl/featurePropertyBag/featurePropertyBag.xml" ContentType="application/vnd.ms-excel.featurepropertybag+xml"/></Types>',
      ),
      { createFolders: false },
    );
  }
  const rels = await relsFile.async("string");
  if (!rels.includes("FeaturePropertyBag")) {
    const nextId = Math.max(0, ...Array.from(rels.matchAll(/Id="rId(\d+)"/g)).map((match) => Number(match[1]))) + 1;
    zip.file(
      "xl/_rels/workbook.xml.rels",
      rels.replace(
        "</Relationships>",
        `<Relationship Id="rId${nextId}" Type="http://schemas.microsoft.com/office/2022/11/relationships/FeaturePropertyBag" Target="featurePropertyBag/featurePropertyBag.xml"/></Relationships>`,
      ),
      { createFolders: false },
    );
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// ---- Reading it back

const sheetText = (sheet: Worksheet, row: number, column: number) => spreadsheetCellText(sheet.getCell(row, column).value);
const findSheet = (workbook: Workbook, name: string) =>
  workbook.worksheets.find((sheet) => sheet.name.trim().toLowerCase() === name.toLowerCase());
const isYes = (text: string) => /^(y|yes|true|1|✓|✔|x)$/i.test(text.trim());

// The row (and its columns) whose cells read the given headings, side by side.
function findHeadingRow(sheet: Worksheet, headings: string[], maxRow: number): { row: number; columns: Record<string, number> } | null {
  const wanted = headings.map(headingKey);
  for (let r = 1; r <= maxRow; r += 1) {
    for (let c = 1; c <= 30; c += 1) {
      if (headingKey(sheetText(sheet, r, c)) !== wanted[0]) continue;
      const columns: Record<string, number> = {};
      for (let cc = 1; cc <= 40; cc += 1) {
        const key = headingKey(sheetText(sheet, r, cc));
        if (key && !(key in columns)) columns[key] = cc;
      }
      if (wanted.every((key) => key in columns)) return { row: r, columns };
    }
  }
  return null;
}

// null: not a template (no Lists — or older Data — sheet with the template's first cell): the old cutlist sheet's import
// reads it.
export function parseCutlistTemplateWorkbook(workbook: Workbook): CutlistTemplateParsed | null {
  const marked = [findSheet(workbook, LISTS_SHEET), findSheet(workbook, LEGACY_DATA_SHEET)].find(
    (sheet) => sheet && sheetText(sheet, 1, 1) === CUTLIST_TEMPLATE_MARKER,
  );
  if (!marked) return null;
  // The Dashboard (an older template kept its boards on its Data sheet, and had no Dashboard).
  const dashboard = findSheet(workbook, DASHBOARD_SHEET) ?? marked;
  const dashboardLastRow = Math.min(dashboard.rowCount, 2000);

  // Global Job Selections: each label's value, beside it.
  const global = Object.fromEntries(GLOBAL_FIELDS.map((field) => [field.key, ""])) as CutlistTemplateGlobal;
  for (const field of GLOBAL_FIELDS) {
    const group = GLOBAL_GROUPS[field.group];
    // (One without a label of its own: found by the labelled one on its row.)
    const anchor = field.label ? field : GLOBAL_FIELDS.find((item) => item.group === field.group && item.row === field.row && item.label);
    if (!anchor) continue;
    const offset = (field.column ?? group.valueColumn) - group.labelColumn;
    for (let r = 1; r <= Math.min(dashboardLastRow, 20) && !global[field.key]; r += 1) {
      for (let c = 1; c <= 20; c += 1) {
        if (sheetText(dashboard, r, c).toLowerCase() !== anchor.label.toLowerCase()) continue;
        global[field.key] = sheetText(dashboard, r, c + offset);
        break;
      }
    }
  }

  // Project Sections.
  const sections: CutlistTemplateParsed["sections"] = [];
  const sectionHead = findHeadingRow(dashboard, ["Section", "Name", "Drawer Type"], Math.min(dashboardLastRow, 60));
  if (sectionHead) {
    const { section, name, drawertype } = sectionHead.columns;
    for (let r = sectionHead.row + 1; r <= Math.min(dashboardLastRow, sectionHead.row + 200); r += 1) {
      if (/order section/i.test(sheetText(dashboard, r, section)) || /order section/i.test(sheetText(dashboard, r, 2))) break;
      const sectionName = sheetText(dashboard, r, section);
      const extra = sheetText(dashboard, r, name);
      const full = sectionName && extra ? `${sectionName}: ${extra}` : sectionName || extra;
      if (!full) continue;
      const drawerType = sheetText(dashboard, r, drawertype);
      sections.push({ name: full, drawerType: drawerType.toLowerCase() === GLOBAL_DRAWER_TYPE.toLowerCase() ? "" : drawerType });
    }
  }

  // The boards: under the row headed Colour / Thickness …
  const boards: CutlistTemplateBoard[] = [];
  const boardHead = findHeadingRow(dashboard, ["Colour", "Thickness", "Finish"], Math.min(dashboardLastRow, 60));
  if (boardHead) {
    const at = (r: number, key: string) => (boardHead.columns[key] ? sheetText(dashboard, r, boardHead.columns[key]) : "");
    for (let r = boardHead.row + 1; r <= Math.min(dashboardLastRow, boardHead.row + 200); r += 1) {
      const rowText = [1, 2, 6].map((c) => sheetText(dashboard, r, c)).join(" ");
      if (/order section|part types/i.test(rowText)) break;
      const colour = at(r, "colour");
      if (!colour) continue;
      boards.push({
        colour,
        thickness: at(r, "thickness").replace(/mm$/i, "").trim(),
        finish: at(r, "finish"),
        sheetSize: at(r, "sheetsize"),
        edging: at(r, "edging") || "Matching",
        grain: isYes(at(r, "grain")),
        lacquer: isYes(at(r, "lacquer")),
        edgeTape: at(r, "edgetape"),
        sheets: at(r, "sheets"),
      });
    }
  }

  // The Order Section: hinges, other items and misc (its drawers are counted from the rooms).
  const order: CutlistTemplateParsed["order"] = { hinges: [], other: [], misc: [] };
  // (Its headings row: Hinge Type with Part Name beside it — not Global Job Selections' own Hinge Type.)
  const orderHead = findHeadingRow(dashboard, ["Hinge Type", "Part Name"], dashboardLastRow);
  if (orderHead) {
    // Each list's Quantity: the first after its name's column.
    const quantityAfter = (column: number) => {
      for (let c = column + 1; c <= column + 8; c += 1) if (headingKey(sheetText(dashboard, orderHead.row, c)) === "quantity") return c;
      return 0;
    };
    const lists: Array<[keyof typeof order, number]> = [
      ["hinges", orderHead.columns.hingetype ?? 0],
      ["other", orderHead.columns.item ?? 0],
      ["misc", orderHead.columns.partname ?? 0],
    ];
    for (let r = orderHead.row + 1; r <= Math.min(dashboardLastRow, orderHead.row + 300); r += 1) {
      for (const [key, column] of lists) {
        if (!column) continue;
        const name = sheetText(dashboard, r, column);
        if (!name) continue;
        const qtyColumn = quantityAfter(column);
        order[key].push({ name, qty: qtyColumn ? sheetText(dashboard, r, qtyColumn) : "" });
      }
    }
  }

  // The rooms: every other sheet with the cutlist's headings.
  const rooms: CutlistTemplateParsed["rooms"] = [];
  const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
  for (const sheet of workbook.worksheets) {
    const name = sheet.name.trim();
    if (NOT_ROOM_SHEETS.includes(name.toLowerCase())) continue;
    const lastRow = Math.min(sheet.rowCount, 5000);
    let headingRow = 0;
    const columnOf: Partial<Record<PartField, number>> = {};
    for (let r = 1; r <= Math.min(lastRow, 30) && !headingRow; r += 1) {
      const found: Partial<Record<PartField, number>> = {};
      for (let c = 1; c <= 30; c += 1) {
        const field = PART_FIELD_BY_HEADING[headingKey(sheetText(sheet, r, c))];
        if (field && !found[field]) found[field] = c;
      }
      if (found.partType && found.name) {
        headingRow = r;
        Object.assign(columnOf, found);
      }
    }
    if (!headingRow) continue;
    // Above the headings: the value beside a label (its Room, an older template's Drawer Type).
    const besideLabel = (text: string) => {
      for (let r = 1; r < headingRow; r += 1) {
        for (let c = 1; c <= 6; c += 1) {
          if (headingKey(sheetText(sheet, r, c)) !== text) continue;
          for (let v = c + 1; v <= c + 4; v += 1) if (sheetText(sheet, r, v)) return sheetText(sheet, r, v);
          return "";
        }
      }
      return "";
    };
    const roomName = besideLabel("room") || name;
    // Its drawer type: picked on its sheet, or else its section's own — blank: the project's (Global).
    const section = sections.find((item) => sameName(item.name, roomName));
    const ownDrawerType = besideLabel("drawertype");
    const drawerType =
      ownDrawerType && ownDrawerType.toLowerCase() !== GLOBAL_DRAWER_TYPE.toLowerCase() ? ownDrawerType : section?.drawerType ?? "";
    const rows: CutlistTemplateRow[] = [];
    for (let r = headingRow + 1; r <= lastRow; r += 1) {
      const at = (field: PartField) => (columnOf[field] ? sheetText(sheet, r, columnOf[field] as number) : "");
      const row: CutlistTemplateRow = {
        sheetRow: r,
        partType: at("partType"),
        board: at("board"),
        name: at("name"),
        height: at("height"),
        width: at("width"),
        depth: at("depth"),
        quantity: at("quantity"),
        clashLong: at("clashLong"),
        clashShort: at("clashShort"),
        grain: at("grain"),
        information: at("information"),
        cabinet: at("cabinet"),
        fixedShelves: at("fixedShelves"),
        fixedDrilling: at("fixedDrilling"),
        adjustableShelves: at("adjustableShelves"),
        adjustableDrilling: at("adjustableDrilling"),
        clashBottom: at("clashBottom"),
        fullTop: at("fullTop"),
      };
      // Rows with nothing to cut (the empty rows, with only their dropdowns) are left out.
      if (!row.name && !row.partType && !row.height && !row.width) continue;
      rows.push(row);
    }
    rooms.push({ sheetName: name, roomName, drawerType, rows });
  }

  // The notes: each box under its title (found by its hidden key).
  const notes: CutlistTemplateParsed["notes"] = { production: "", contractors: {} };
  const notesSheet = findSheet(workbook, NOTES_SHEET);
  if (notesSheet) {
    const lastRow = Math.min(notesSheet.rowCount, 2000);
    for (let r = 3; r < lastRow; r += 1) {
      const key = sheetText(notesSheet, r, NOTE_KEY_COLUMN);
      if (!key) continue;
      const text = spreadsheetCellText(notesSheet.getCell(r + 1, 1).value);
      if (!text) continue;
      if (key === "notes") notes.production = text;
      else if (key.startsWith("contractor:")) notes.contractors[key.slice("contractor:".length)] = text;
    }
  }
  return { global, sections, boards, order, rooms, notes };
}
