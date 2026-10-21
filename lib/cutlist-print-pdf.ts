"use client";

import type { jsPDF as JsPdf } from "jspdf";
import { activeLength } from "@/lib/company-formats";
import type { CutlistRow } from "@/lib/cutlist-types";
import { drawPrintTitlePage, type PrintTitlePage } from "@/lib/print-title-page";

// The production cutlist to print, laid out as the old cutlist spreadsheet was — from the Print button in the cutlist's
// top bar (and Production's Print dialog):
// - each part type on its own page(s), in the company's part type order. Every page's header: PROJECT CUTLIST and the
//   part type (top left), a NOTES box (the carcass thickness, base and tall cabinet heights, and the hinge type), and the
//   company and the project (top right);
// - a table for each of its boards (in the order they come), one under another: a bar in the part type's colour with
//   the board (and how many parts), the column headings — Room, Part Name, Height, Width, Depth,
//   Quantity, Clashing (its two sides), Hinges (a door's side, then where they go) and Information — then its parts,
//   banded white / grey, with black lines between the columns. The grain's size bold and underlined (as the list shows
//   it). A column none of the part type's parts has anything in is left out (Room, Part Name and Information always
//   there);
// - under a part, a second line with everything else it has: a cabinet's Base / Wall, top, shelves and drilling; door /
//   drawer fronts (and their sizes); its grain; left out of nesting; what it's part of;
// - a drawer: not its own sizes, but a row with its name (and information), then its pieces (its bottom and backs, as the
//   list breaks it down) under it, each with its sizes, quantity and clashing;
// - doors (a door part type's): in each board's table, its doors first and then its drawer fronts — when the part type
//   has both, "Doors" / "Drawers" written up a strip down the table's side, beside each;
// - the rest of each part type's last page filled with blank rows, to write extra parts in by hand.
// A part and its second line always stay on the same page; a board's table carries on onto the next page (its bar
// saying so) when it runs out of room. Drawn straight with jsPDF (loaded with the page's other PDF modules), so it's
// made within the click that prints it.

export type CutlistPrintFront = { name: string; height: string; width: string; quantity: string };
export type CutlistPrintPiece = {
  name: string;
  height: string;
  width: string;
  depth: string;
  quantity: string;
  clashLeft: string;
  clashRight: string;
};

export type CutlistPrintInput = {
  companyName: string;
  projectName: string;
  rows: CutlistRow[];
  // Part type name → its colour, and the company's order (Company Settings › Production › Part types).
  partTypeColors: Record<string, string>;
  partTypeOrder: string[];
  // A row's board as the list shows it (its name).
  boardOf: (value: string) => string;
  // Which kind of part a row is (its part type's) — what its second line can have.
  kindOf: (row: CutlistRow) => "cabinetry" | "drawer" | "door" | "";
  // A door / drawer front row's fronts, as the list breaks it down (when it's set up as doors or drawers).
  frontsOf?: (row: CutlistRow) => CutlistPrintFront[];
  // A part printed as its pieces instead of its own row (a drawer: its bottom and backs) — none: as it is.
  piecesOf?: (row: CutlistRow) => CutlistPrintPiece[];
  // A row's room's own hinge type (Production › Hardware), when that room has its own hardware.
  hingeTypeOf?: (row: CutlistRow) => string;
  // The NOTES box — each as it's shown (with its unit), "" when not set.
  notes: { carcassThickness: string; baseCabHeight: string; tallCabHeight: string; hingeType: string };
  // Beside the page numbers: e.g. "Printed 21 Oct 2026 · Sizes in mm".
  footer: string;
  // A title sheet first (lib/print-title-page.ts) — not numbered with the pages after it.
  titlePage?: PrintTitlePage;
  // false: no "Page n of m" of its own (in a project folder, which numbers all its pages — the project's page).
  pageNumbers?: boolean;
};

type Rgb = [number, number, number];
type Segment = [label: string, value: string];

const toStr = (value: unknown) => String(value ?? "").trim();
const list = (values: unknown) => (Array.isArray(values) ? values.map(toStr).filter(Boolean) : toStr(values) ? [toStr(values)] : []);

const hexToRgb = (hex: string): Rgb | null => {
  const match = String(hex || "").trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!match) return null;
  const value = match[1].length === 3 ? match[1].split("").map((c) => c + c).join("") : match[1];
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)];
};
const isLight = (rgb: Rgb) => (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.6;
// Towards white (keep: how much of the colour stays).
const tint = (rgb: Rgb, keep: number): Rgb => rgb.map((channel) => Math.round(255 - (255 - channel) * keep)) as Rgb;
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
const BLUE: Rgb = [47, 84, 150];
const BAND: Rgb = [226, 226, 226];
const DETAIL_TEXT: Rgb = [64, 64, 64];
const LIGHT_LINE: Rgb = [185, 185, 185];
const FALLBACK_COLOUR: Rgb = [203, 213, 225];

// The page (A4 landscape, pt).
const MARGIN = 22;
const HEADER_TOP = 20;
const NOTES_H = 58;
const TABLE_TOP = HEADER_TOP + NOTES_H + 14;
// A board's bar, and its column headings.
const BOARD_H = 15;
const HEAD_H = 14;
// Between one board's table and the next.
const TABLE_GAP = 10;
const PAD_X = 4;
const FONT = 7.5;
const DETAIL_FONT = 6.6;
const LINE = 1.15;
// A row of one line (and each blank row).
const ROW_H = FONT * LINE + 4.4;
const SEGMENT_GAP = 14;
// The Room column at its widest.
const ROOM_MAX_W = 150;
// The "Doors" / "Drawers" strip's word.
const STRIP_FONT = 6.5;
// A drawer's pieces' names, in from its own.
const PIECE_INDENT = 10;
// Between one thing and the next in the Hinges column's positions.
const HINGE_GAP = 8;

// Columns that go together under one heading: Clashing's two sides, Hinges' side and positions.
const FIRST_OF_PAIR: string[] = ["clashLeft", "hingeSide"];
const SECOND_OF_PAIR: string[] = ["clashRight", "hinges"];

type ColumnKey = "group" | "room" | "name" | "height" | "width" | "depth" | "quantity" | "clashLeft" | "clashRight" | "hingeSide" | "hinges" | "information";
const COLUMNS: Array<{ key: ColumnKey; header: string; width: number; align: "left" | "center" }> = [
  // (A door part type's with both doors and drawer fronts: the strip down its side, "Doors" / "Drawers" up it.)
  { key: "group", header: "", width: 13, align: "center" },
  // (Room: as wide as its longest room name — see below.)
  { key: "room", header: "Room", width: 0, align: "left" },
  { key: "name", header: "Part Name", width: 150, align: "left" },
  { key: "height", header: "Height", width: 46, align: "center" },
  { key: "width", header: "Width", width: 46, align: "center" },
  { key: "depth", header: "Depth", width: 46, align: "center" },
  { key: "quantity", header: "Quantity", width: 48, align: "center" },
  { key: "clashLeft", header: "Clashing", width: 28, align: "center" },
  { key: "clashRight", header: "", width: 28, align: "center" },
  // Hinges: its side, then where they go (under the one heading, as Clashing's two sides).
  { key: "hingeSide", header: "Hinges", width: 36, align: "center" },
  { key: "hinges", header: "", width: 120, align: "left" },
  // (Information: the rest of the page's width.)
  { key: "information", header: "Information", width: 0, align: "left" },
];

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

// A stored size (mm) in the company's unit, without it (the footer says which); anything else as it's written.
const size = (value: unknown) => {
  const raw = toStr(value);
  return /^-?\d+(\.\d+)?$/.test(raw) ? activeLength(raw, { withUnit: false }) : raw;
};

// Its clashing's two sides: the left (L) and the short side (S) — as it keeps them, or out of its clashing text.
function clashSides(row: CutlistRow): [string, string] {
  const left = toStr(row.clashLeft);
  const right = toStr(row.clashRight);
  if (left || right) return [left, right];
  const tokens = toStr(row.clashing).split(/[\s,|/]+/).filter(Boolean);
  return [tokens.filter((token) => /L$/i.test(token)).join(" "), tokens.filter((token) => !/L$/i.test(token)).join(" ")];
}

const drilling = (value: unknown) => {
  const text = toStr(value).toLowerCase();
  if (["even spacing", "even", "spacing", "equal spacing", "evenly spaced", "even-spaced"].includes(text)) return "Even Spacing";
  if (["centre", "center", "centred", "centered"].includes(text)) return "Centre";
  return "";
};
const shelves = (count: unknown, drill: unknown) => {
  const n = Number.parseFloat(toStr(count));
  if (!Number.isFinite(n) || n < 1) return "";
  return `${toStr(count)} · ${drilling(drill) ? `${drilling(drill)} drilling` : "No drilling"}`;
};
const side = (value: unknown, gap: unknown) =>
  value === "panel" || value === "front" ? `${value === "panel" ? "Panel" : "Front"}${toStr(gap) ? ` (${size(gap)})` : ""}` : "";

// A door part type's row: a door, or a drawer front — split out of a drawer bank, set up as drawers, or (a plain row) named
// as one and without hinges. Anything else is a door.
function frontKind(row: CutlistRow): "door" | "drawer" {
  if (row.bankGroupId || row.doorMode === "drawer") return "drawer";
  if (row.doorMode === "door") return "door";
  if (list(row.hingesUp).length || list(row.hingesDown).length) return "door";
  return /drawer/i.test(toStr(row.name)) ? "drawer" : "door";
}

// A door's hinges' positions, for its Hinges column: where they go (up / down — or, hinged at the top, left / right), and
// its room's own hinge type when that's not the project's. (Its side: the column's own cell, before them.)
function hingeSegments(row: CutlistRow, input: CutlistPrintInput): Segment[] {
  if (input.kindOf(row) !== "door" || row.bankGroupId) return [];
  const out: Segment[] = [];
  const up = list(row.hingesUp);
  const down = list(row.hingesDown);
  const top = row.hingeSide === "Top";
  if (up.length) out.push([top ? "LH" : "Up", up.join(", ")]);
  if (down.length) out.push([top ? "RH" : "Down", down.join(", ")]);
  const roomHinge = toStr(input.hingeTypeOf?.(row));
  if ((up.length || down.length) && roomHinge && roomHinge.toLowerCase() !== input.notes.hingeType.trim().toLowerCase()) {
    out.push(["Type", roomHinge]);
  }
  return out;
}

type Values = Record<ColumnKey, string>;
const BLANK: Values = {
  group: "",
  room: "",
  name: "",
  height: "",
  width: "",
  depth: "",
  quantity: "",
  clashLeft: "",
  clashRight: "",
  hingeSide: "",
  hinges: "",
  information: "",
};

// What a part prints in its columns: its own row's values (a drawer's: its name and information, then its pieces'), its
// hinges, and a cabinet's shelves' clashing (over both sides, as the list shows it).
function printedPart(row: CutlistRow, input: CutlistPrintInput): { own: Values; pieces: Values[]; hinges: Segment[]; cabinetClash: string } {
  const pieces = (input.piecesOf?.(row) ?? []).filter((piece) => (Number.parseInt(toStr(piece.quantity), 10) || 0) > 0);
  if (pieces.length) {
    return {
      own: { ...BLANK, room: toStr(row.room), name: toStr(row.name), information: toStr(row.information) },
      pieces: pieces.map((piece) => ({
        ...BLANK,
        name: piece.name,
        height: size(piece.height),
        width: size(piece.width),
        depth: size(piece.depth),
        quantity: toStr(piece.quantity),
        clashLeft: toStr(piece.clashLeft),
        clashRight: toStr(piece.clashRight),
      })),
      hinges: [],
      cabinetClash: "",
    };
  }
  const [clashLeft, clashRight] = clashSides(row);
  const cabinetClash = input.kindOf(row) === "cabinetry" ? toStr(row.cabinetryClashBottom) : "";
  return {
    own: {
      group: "",
      room: toStr(row.room),
      name: toStr(row.name),
      height: size(row.height),
      width: size(row.width),
      depth: size(row.depth),
      quantity: toStr(row.quantity),
      clashLeft: cabinetClash ? "" : clashLeft,
      clashRight: cabinetClash ? "" : clashRight,
      hingeSide: input.kindOf(row) === "door" && !row.bankGroupId ? toStr(row.hingeSide) : "",
      hinges: "",
      information: toStr(row.information),
    },
    pieces: [],
    hinges: hingeSegments(row, input),
    cabinetClash,
  };
}

// Everything a row has beyond its main columns — its second line.
function detailSegments(row: CutlistRow, input: CutlistPrintInput): Segment[] {
  const kind = input.kindOf(row);
  const out: Segment[] = [];
  if (kind === "cabinetry") {
    const wall = row.cabinetryKind === "wall";
    out.push(["Cabinet", wall ? "Wall" : "Base"]);
    if (!wall) out.push(["Top", row.cabinetryFullTop ? "Full Top" : "2 Rails"]);
    const fixed = shelves(row.fixedShelf, row.fixedShelfDrilling);
    if (fixed) out.push(["Fixed Shelves", fixed]);
    const adjustable = shelves(row.adjustableShelf, row.adjustableShelfDrilling);
    if (adjustable) out.push(["Adjustable Shelves", adjustable]);
  }
  if (kind === "door" && (row.doorMode === "door" || row.doorMode === "drawer")) {
    const count = toStr(row.doorFrontCount);
    const noun = row.doorMode === "drawer" ? "Drawer" : "Door";
    out.push(["Fronts", count ? `${count} ${noun}${count === "1" ? "" : "s"}` : `${noun}s`]);
    if (toStr(row.doorTopGap)) out.push(["Top Gap", size(row.doorTopGap)]);
    const between = list(row.doorBetweenGaps);
    if (between.length) out.push(["Gaps Between", between.map(size).join(", ")]);
    else if (toStr(row.doorBetweenGap)) out.push(["Gap Between", size(row.doorBetweenGap)]);
    const left = side(row.doorSideLeft, row.doorSideLeftGap);
    if (left) out.push(["Left Side", left]);
    const right = side(row.doorSideRight, row.doorSideRightGap);
    if (right) out.push(["Right Side", right]);
    const fronts = input.frontsOf?.(row) ?? [];
    if (fronts.length) {
      out.push([
        "Front Sizes",
        fronts
          .map((front) => {
            const quantity = Number.parseInt(toStr(front.quantity), 10) || 1;
            return `${front.name ? `${front.name} ` : ""}${size(front.height)} × ${size(front.width)}${quantity > 1 ? ` ×${quantity}` : ""}`;
          })
          .join(", "),
      ]);
    }
  }
  const axis = grainAxis(row);
  if (axis) out.push(["Grain", axis === "height" ? "Height" : axis === "width" ? "Width" : "Depth"]);
  if (row.includeInNesting === false) out.push(["Nesting", "Left out"]);
  if (toStr(row.parentName)) out.push(["Part Of", toStr(row.parentName)]);
  return out;
}

// Labelled values (the second line's, the Hinges column's) laid out across `width` at `fontSize`: each label bold and its
// value plain, `gap` between them, wrapping onto more lines as it needs — the words of each line with where they start.
type Word = { text: string; bold: boolean; x: number };
function layoutSegments(doc: JsPdf, segments: Segment[], width: number, fontSize = DETAIL_FONT, gap = SEGMENT_GAP): Word[][] {
  const lines: Word[][] = [[]];
  let x = 0;
  doc.setFontSize(fontSize);
  const widthOf = (word: { text: string; bold: boolean }) => {
    doc.setFont("helvetica", word.bold ? "bold" : "normal");
    const w = doc.getTextWidth(word.text);
    doc.setFont("helvetica", "normal");
    return w;
  };
  segments.forEach(([label, value], index) => {
    const words = [
      ...`${label}:`.split(/\s+/).map((text) => ({ text, bold: true })),
      ...value.split(/\s+/).filter(Boolean).map((text) => ({ text, bold: false })),
    ];
    // A label stays with its value's first word: onto the next line together when they don't both fit.
    const labelWords = `${label}:`.split(/\s+/).length;
    const head = words.slice(0, labelWords + 1);
    const headW = head.reduce((sum, word) => sum + widthOf(word), 0) + doc.getTextWidth(" ") * (head.length - 1);
    if (x > 0 && x + gap + headW > width) {
      lines.push([]);
      x = 0;
    }
    words.forEach((word, wordIndex) => {
      const w = widthOf(word);
      let space = x === 0 ? 0 : wordIndex === 0 && index > 0 ? gap : doc.getTextWidth(" ");
      if (x > 0 && x + space + w > width) {
        lines.push([]);
        x = 0;
        space = 0;
      }
      lines[lines.length - 1].push({ ...word, x: x + space });
      x += space + w;
    });
  });
  return lines.filter((line) => line.length);
}

// The text's baseline for `lines` lines of `fontSize` centred in a box from `top`, `height` high.
const baselineFor = (top: number, height: number, lines: number, fontSize: number) =>
  top + (height - lines * fontSize * LINE) / 2 + (fontSize * LINE + fontSize * 0.72) / 2;

type JsPdfCtor = typeof import("jspdf").jsPDF;

// The PDF, and how many pages it is. Null when there's nothing in the cutlist to print.
export function buildCutlistPrintPdf(jsPDF: JsPdfCtor, input: CutlistPrintInput): { blob: Blob; pageCount: number } | null {
  const rows = input.rows.filter((row) => toStr(row.name) || toStr(row.height) || toStr(row.width));
  if (!rows.length) return null;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const tableWidth = pageWidth - MARGIN * 2;
  const tableBottom = pageHeight - 30;
  // Room: just wide enough for the longest room name (or its heading), with the cells' padding either side — up to
  // ROOM_MAX_W (longer ones wrap). The same on every page.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT);
  let roomTextW = doc.getTextWidth("Room");
  doc.setFont("helvetica", "normal");
  for (const row of rows) roomTextW = Math.max(roomTextW, doc.getTextWidth(toStr(row.room)));
  const roomW = Math.min(ROOM_MAX_W, Math.ceil(roomTextW) + 1 + PAD_X * 2);
  // A part type's columns: only those its parts have something in (Room, Part Name and Information always; Clashing's
  // two sides together) — each one's width and left edge, Information taking what's left.
  let columns = COLUMNS;
  let widths: number[] = [];
  let lefts: number[] = [];
  // (A drawer's own row: its Part Name over these.)
  let spanned: number[] = [];
  // Part Name's column, and the second line's start (Part Name's left edge) and width.
  let nameIndex = 0;
  let detailLeft = 0;
  let detailWidth = 0;
  const setColumnsFor = (sectionRows: CutlistRow[]) => {
    const used = new Set<ColumnKey>(["room", "name", "information"]);
    const fronts = new Set(sectionRows.filter((row) => input.kindOf(row) === "door").map(frontKind));
    if (fronts.size > 1) used.add("group");
    for (const row of sectionRows) {
      const printed = printedPart(row, input);
      for (const values of [printed.own, ...printed.pieces]) {
        for (const key of Object.keys(values) as ColumnKey[]) if (values[key]) used.add(key);
      }
      if (printed.cabinetClash) used.add("clashLeft");
      if (printed.hinges.length) used.add("hinges");
    }
    // (Clashing's two sides, and Hinges' side and positions, together.)
    for (const pair of [["clashLeft", "clashRight"], ["hingeSide", "hinges"]] as const) {
      if (used.has(pair[0]) || used.has(pair[1])) pair.forEach((key) => used.add(key));
    }
    columns = COLUMNS.filter((column) => used.has(column.key));
    const ownWidth = (key: ColumnKey) => (key === "room" ? roomW : (COLUMNS.find((column) => column.key === key)?.width ?? 0));
    const fixedWidth = columns.reduce((sum, column) => sum + (column.key === "information" ? 0 : ownWidth(column.key)), 0);
    widths = columns.map((column) => (column.key === "information" ? tableWidth - fixedWidth : ownWidth(column.key)));
    lefts = widths.map((_, index) => MARGIN + widths.slice(0, index).reduce((sum, w) => sum + w, 0));
    spanned = columns
      .map((column, index) => (["height", "width", "depth", "quantity", "clashLeft", "clashRight", "hingeSide", "hinges"].includes(column.key) ? index : -1))
      .filter((index) => index >= 0);
    nameIndex = columns.findIndex((column) => column.key === "name");
    detailLeft = lefts[nameIndex];
    detailWidth = MARGIN + tableWidth - detailLeft;
  };
  setColumnsFor(rows);
  const columnIndex = (key: ColumnKey) => columns.findIndex((column) => column.key === key);

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

  // A line of text cut to fit `width` (with an ellipsis), in the current font.
  const fit = (text: string, width: number) => {
    if (doc.getTextWidth(text) <= width) return text;
    let cut = text;
    while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > width) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  };

  // The page's header: PROJECT CUTLIST and the part type; the NOTES box; the company and the project.
  const drawHeader = (partType: string) => {
    const leftW = 200;
    const rightW = 220;
    doc.setTextColor(...BLUE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text("PROJECT CUTLIST", MARGIN, HEADER_TOP + 16);
    doc.setDrawColor(...BLUE);
    doc.setLineWidth(1.4);
    doc.line(MARGIN, HEADER_TOP + 23, MARGIN + leftW, HEADER_TOP + 23);
    doc.setTextColor(...BLACK);
    doc.setFontSize(15);
    doc.text(fit(partType, leftW), MARGIN, HEADER_TOP + 44);

    const right = pageWidth - MARGIN;
    doc.setTextColor(...BLUE);
    doc.setFontSize(17);
    doc.text(fit(input.companyName || "", rightW), right, HEADER_TOP + 16, { align: "right" });
    doc.line(right - rightW, HEADER_TOP + 23, right, HEADER_TOP + 23);
    doc.setTextColor(...BLACK);
    doc.setFontSize(13);
    doc.text(fit(input.projectName || "Project", rightW), right, HEADER_TOP + 43, { align: "right" });

    const boxX = MARGIN + leftW + 24;
    const boxW = right - rightW - 24 - boxX;
    doc.setDrawColor(...BLUE);
    doc.setLineWidth(1.2);
    doc.rect(boxX, HEADER_TOP, boxW, NOTES_H, "S");
    doc.setTextColor(...BLUE);
    doc.setFontSize(9);
    doc.text("NOTES:", boxX + 8, HEADER_TOP + 13);
    const colW = (boxW - 24) / 2;
    const note = (label: string, value: string, x: number, y: number) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...BLACK);
      doc.text(`${label}:`, x, y);
      const labelW = doc.getTextWidth(`${label}: `);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(value || "-", Math.max(20, colW - labelW)) as string[];
      doc.text(lines.slice(0, 3), x + labelW, y);
    };
    note("Carcass Thickness", input.notes.carcassThickness, boxX + 8, HEADER_TOP + 28);
    note("Base Cab Height", input.notes.baseCabHeight, boxX + 8, HEADER_TOP + 40);
    note("Tall Cab Height", input.notes.tallCabHeight, boxX + 8, HEADER_TOP + 52);
    note("Hinge Type", input.notes.hingeType, boxX + 16 + colW, HEADER_TOP + 28);
  };

  // A board's bar, in the part type's colour: the board, and how many parts (or that it carries on from the page before).
  const drawBoardBar = (colour: Rgb, board: string, note: string, y: number) => {
    const text = isLight(colour) ? BLACK : WHITE;
    doc.setFillColor(...colour);
    doc.rect(MARGIN, y, tableWidth, BOARD_H, "F");
    doc.setTextColor(...text);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    const noteW = doc.getTextWidth(note);
    doc.text(note, MARGIN + tableWidth - PAD_X - 2, baselineFor(y, BOARD_H, 1, 7.5), { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(fit(board, tableWidth - noteW - PAD_X * 4 - 12), MARGIN + PAD_X + 2, baselineFor(y, BOARD_H, 1, 9));
    doc.setDrawColor(...BLACK);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y + BOARD_H, MARGIN + tableWidth, y + BOARD_H);
  };

  // The table's column headings, in a lighter shade of the part type's colour.
  const drawHead = (colour: Rgb, y: number) => {
    const text = isLight(colour) ? BLACK : WHITE;
    doc.setFillColor(...colour);
    doc.rect(MARGIN, y, tableWidth, HEAD_H, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT);
    doc.setTextColor(...text);
    columns.forEach((column, index) => {
      if (SECOND_OF_PAIR.includes(column.key)) return;
      // Clashing and Hinges: over both their cells.
      const pair = FIRST_OF_PAIR.includes(column.key);
      const w = pair ? widths[index] + widths[index + 1] : widths[index];
      const x = column.align === "center" || pair ? lefts[index] + w / 2 : lefts[index] + PAD_X;
      doc.text(fit(column.header, w - PAD_X * 2), x, baselineFor(y, HEAD_H, 1, FONT), { align: column.align === "center" || pair ? "center" : "left" });
    });
    doc.setDrawColor(...BLACK);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, y + HEAD_H, MARGIN + tableWidth, y + HEAD_H);
    lefts.forEach((x, index) => {
      if (index > 0 && !SECOND_OF_PAIR.includes(columns[index].key)) doc.line(x, y, x, y + HEAD_H);
    });
  };

  // The lines between the columns, from `top` to `bottom` — only up to `upTo` (the second line: just its first ones),
  // and not at the left edges of `skip`'s columns.
  // (Between Hinges' side and positions: a lighter one.)
  const drawColumnLines = (top: number, bottom: number, upTo = columns.length, skip: number[] = []) => {
    for (let index = 1; index < upTo; index += 1) {
      if (skip.includes(index)) continue;
      const light = columns[index].key === "hinges";
      doc.setDrawColor(...(light ? LIGHT_LINE : BLACK));
      doc.setLineWidth(light ? 0.35 : 0.5);
      doc.line(lefts[index], top, lefts[index], bottom);
    }
  };

  // A table row: each column's text (wrapped), and how it's shown.
  type TableLine = {
    cells: string[][];
    height: number;
    // Its Part Name bold (a drawer's own row), or in from the edge (its pieces').
    bold?: boolean;
    indent?: number;
    // The size its grain runs along: bold and underlined.
    axis?: "height" | "width" | "depth" | null;
    // A cabinet's shelves' clashing: over both sides.
    mergedClash?: string;
    // Its Part Name over the sizes, quantity and clashing too (a drawer's own row: it has none of its own).
    nameSpan?: boolean;
    // Its Hinges column's words (labels bold).
    hinges?: Word[][];
  };
  const tableLine = (values: Record<ColumnKey, string>, options: Omit<TableLine, "cells" | "height"> = {}): TableLine => {
    doc.setFontSize(FONT);
    const cells = columns.map((column, index) => {
      if (options.nameSpan && spanned.includes(index)) return [];
      const name = index === nameIndex;
      const w = name && options.nameSpan ? widths[index] + spanned.reduce((sum, i) => sum + widths[i], 0) : widths[index];
      doc.setFont("helvetica", name && options.bold ? "bold" : "normal");
      return doc.splitTextToSize(values[column.key], w - PAD_X * 2 - (name ? (options.indent ?? 0) : 0)) as string[];
    });
    const lines = Math.max(options.hinges?.length ?? 0, ...cells.map((cell) => cell.length));
    const height = Math.max(ROW_H, lines * FONT * LINE + 4.4);
    return { ...options, cells, height };
  };
  // A part laid out: its row (or a drawer's: its own row, then its pieces'), its second line's words (under its own
  // row), and how high it all is.
  const layoutPart = (row: CutlistRow) => {
    const printed = printedPart(row, input);
    const before: TableLine[] = [];
    const after: TableLine[] = [];
    if (printed.pieces.length) {
      before.push(tableLine(printed.own, { bold: true, nameSpan: true }));
      for (const piece of printed.pieces) after.push(tableLine(piece, { indent: PIECE_INDENT }));
    } else {
      const hingesIndex = columnIndex("hinges");
      const hinges = hingesIndex < 0 ? [] : layoutSegments(doc, printed.hinges, widths[hingesIndex] - PAD_X * 2, FONT, HINGE_GAP);
      before.push(tableLine(printed.own, { axis: grainAxis(row), mergedClash: printed.cabinetClash, hinges }));
    }
    const segments = detailSegments(row, input);
    const detailLines = segments.length ? layoutSegments(doc, segments, detailWidth - PAD_X * 2) : [];
    const detailH = detailLines.length ? detailLines.length * DETAIL_FONT * LINE + 2.5 : 0;
    const height = [...before, ...after].reduce((sum, line) => sum + line.height, 0) + detailH;
    // How many parts it is: its pieces', or its own quantity.
    const parts = printed.pieces.length
      ? printed.pieces.reduce((sum, piece) => sum + (Number.parseInt(piece.quantity, 10) || 0), 0)
      : Number(row.quantity) || 0;
    return { before, after, detailLines, detailH, height, parts };
  };

  // A table row, from `y`.
  const drawLine = (line: TableLine, y: number) => {
    doc.setTextColor(...BLACK);
    columns.forEach((column, index) => {
      const cell = line.cells[index];
      if (!cell.length || !cell[0]) return;
      const grained = (column.key === "height" || column.key === "width" || column.key === "depth") && column.key === line.axis;
      const name = index === nameIndex;
      doc.setFont("helvetica", grained || (name && line.bold) ? "bold" : "normal");
      doc.setFontSize(FONT);
      const x = column.align === "center" ? lefts[index] + widths[index] / 2 : lefts[index] + PAD_X + (name ? (line.indent ?? 0) : 0);
      const baseline = baselineFor(y, line.height, cell.length, FONT);
      doc.text(cell, x, baseline, { align: column.align });
      // The grain's size underlined.
      if (grained) {
        const w = doc.getTextWidth(cell[0]);
        doc.setDrawColor(...BLACK);
        doc.setLineWidth(0.6);
        doc.line(x - w / 2, baseline + 1.4, x + w / 2, baseline + 1.4);
      }
    });
    // Its hinges: each label bold, its value plain — centred up and down as the other cells.
    const hingesIndex = columnIndex("hinges");
    if (line.hinges?.length && hingesIndex >= 0) {
      const first = baselineFor(y, line.height, line.hinges.length, FONT);
      doc.setFontSize(FONT);
      line.hinges.forEach((words, lineIndex) => {
        words.forEach((word) => {
          doc.setFont("helvetica", word.bold ? "bold" : "normal");
          doc.text(word.text, lefts[hingesIndex] + PAD_X + word.x, first + lineIndex * FONT * LINE);
        });
      });
    }
    if (line.mergedClash) {
      const index = columnIndex("clashLeft");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(FONT);
      doc.text(fit(line.mergedClash, widths[index] + widths[index + 1] - 4), lefts[index] + (widths[index] + widths[index + 1]) / 2, baselineFor(y, line.height, 1, FONT), {
        align: "center",
      });
    }
    drawColumnLines(y, y + line.height, columns.length, line.nameSpan ? spanned : line.mergedClash ? [columnIndex("clashRight")] : []);
  };

  // A run of the strip down the table's side, from `top` to `bottom`, in `fill`: its text written up it (smaller, then cut
  // short, when the run's too short for it — only where a page ran out), boxed in.
  const drawStrip = (text: string, top: number, bottom: number, fill: Rgb) => {
    const index = columnIndex("group");
    if (index < 0 || bottom <= top) return;
    const x = lefts[index];
    const w = widths[index];
    const h = bottom - top;
    doc.setFillColor(...fill);
    doc.rect(x, top, w, h, "F");
    doc.setDrawColor(...BLACK);
    doc.setLineWidth(0.5);
    doc.line(x, top, x + w, top);
    doc.line(x, bottom, x + w, bottom);
    doc.line(x + w, top, x + w, bottom);
    const label = text.toUpperCase();
    let fontSize = STRIP_FONT;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fontSize);
    while (fontSize > 4.5 && doc.getTextWidth(label) > h - 4) {
      fontSize -= 0.5;
      doc.setFontSize(fontSize);
    }
    const shown = fit(label, h - 4);
    doc.setTextColor(...(isLight(fill) ? BLACK : WHITE));
    // (Turned a quarter: it reads upwards, its letters' tops to the left — centred across and along the run.)
    doc.text(shown, x + w / 2 + fontSize * 0.36, top + (h + doc.getTextWidth(shown)) / 2, { angle: 90 });
  };

  // A part's rows, from `y`, shaded `fill`: its own row, its second line, then (a drawer's) its pieces.
  const drawPart = (part: ReturnType<typeof layoutPart>, y: number, fill: Rgb) => {
    doc.setFillColor(...fill);
    doc.rect(MARGIN, y, tableWidth, part.height, "F");
    let top = y;
    for (const line of part.before) {
      drawLine(line, top);
      top += line.height;
    }
    if (part.detailLines.length) {
      doc.setFontSize(DETAIL_FONT);
      doc.setTextColor(...DETAIL_TEXT);
      part.detailLines.forEach((line, lineIndex) => {
        const baseline = top + lineIndex * DETAIL_FONT * LINE + DETAIL_FONT * 0.86;
        line.forEach((word) => {
          doc.setFont("helvetica", word.bold ? "bold" : "normal");
          doc.text(word.text, detailLeft + PAD_X + word.x, baseline);
        });
      });
      // (Only the line between Room and the rest.)
      drawColumnLines(top, top + part.detailH, nameIndex + 1);
      top += part.detailH;
    }
    for (const line of part.after) {
      drawLine(line, top);
      top += line.height;
    }
  };

  let pageOpen = false;
  if (input.titlePage) {
    drawPrintTitlePage(doc, input.titlePage);
    pageOpen = true;
  }
  sections.forEach((section) => {
    setColumnsFor(section.rows);
    const colour = hexToRgb(input.partTypeColors[section.type] ?? "") ?? FALLBACK_COLOUR;
    const headingColour = tint(colour, 0.55);
    // Its boards (as the list shows them), each with its parts — in the order they come.
    const boards: Array<{ label: string; rows: CutlistRow[] }> = [];
    for (const row of section.rows) {
      const label = input.boardOf(toStr(row.board)) || "No board";
      const board = boards.find((item) => item.label.toLowerCase() === label.toLowerCase());
      if (board) board.rows.push(row);
      else boards.push({ label, rows: [row] });
    }
    // A table's parts, in order — a door part type's: its doors, then its drawer fronts (each kept in the order they
    // come), each with which it is when the part type's strip shows it.
    const strip = columnIndex("group") >= 0;
    const tableParts = (rows: CutlistRow[]): Array<{ row: CutlistRow; group: string }> => {
      if (!rows.some((row) => input.kindOf(row) === "door")) return rows.map((row) => ({ row, group: "" }));
      const doors = rows.filter((row) => frontKind(row) === "door");
      const drawers = rows.filter((row) => frontKind(row) === "drawer");
      return [...doors.map((row) => ({ row, group: strip ? "Doors" : "" })), ...drawers.map((row) => ({ row, group: strip ? "Drawers" : "" }))];
    };
    // The strip's run on this page: which, and where it started.
    let run: { text: string; top: number } | null = null;
    // Its end: at the end of its doors / drawer fronts, at least as long as its word (a little blank space under the last
    // of them when they're not, when the page has room) — not where the page runs out.
    const endRun = (complete: boolean) => {
      if (!run) return;
      if (complete) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(STRIP_FONT);
        const extra = doc.getTextWidth(run.text.toUpperCase()) + 6 - (y - run.top);
        if (extra > 0 && y + extra <= tableBottom) {
          banded += 1;
          doc.setFillColor(...band());
          doc.rect(MARGIN, y, tableWidth, extra, "F");
          drawColumnLines(y, y + extra);
          y += extra;
        }
      }
      drawStrip(run.text, run.top, y, headingColour);
      run = null;
    };

    let y = TABLE_TOP;
    let tableTop = TABLE_TOP;
    // Banded in pairs (a part and its second line the same shade), from white at the top of each table.
    let banded = 0;
    const band = () => (banded % 2 === 0 ? BAND : WHITE);
    const newPage = () => {
      if (pageOpen) doc.addPage();
      pageOpen = true;
      drawHeader(section.type);
      y = TABLE_TOP;
    };
    // A table's top: its board's bar and the column headings.
    const openTable = (board: { label: string; rows: CutlistRow[] }, continued: boolean) => {
      tableTop = y;
      const parts = board.rows.reduce((sum, row) => sum + layoutPart(row).parts, 0);
      drawBoardBar(colour, board.label, continued ? "continued" : `${parts} part${parts === 1 ? "" : "s"}`, y);
      y += BOARD_H;
      drawHead(headingColour, y);
      y += HEAD_H;
      banded = 0;
    };
    // Its outline, down to where it's got to.
    const closeTable = () => {
      doc.setDrawColor(...BLACK);
      doc.setLineWidth(0.8);
      doc.rect(MARGIN, tableTop, tableWidth, y - tableTop, "S");
    };

    newPage();
    boards.forEach((board, boardIndex) => {
      const parts = tableParts(board.rows);
      // Under the last one, on the same page — when its top and its first part fit there.
      if (boardIndex > 0) {
        y += TABLE_GAP;
        if (y + BOARD_H + HEAD_H + layoutPart(parts[0].row).height > tableBottom) newPage();
      }
      openTable(board, false);
      parts.forEach(({ row, group }) => {
        const part = layoutPart(row);
        // Drawer fronts after doors: the doors' run ends — then a line across between them, and the drawer fronts' run.
        const changed = group !== (run?.text ?? "");
        if (changed) endRun(true);
        // Both of its rows on this page — or on the next (its strip's run carrying on there).
        if (y + part.height > tableBottom && y > tableTop + BOARD_H + HEAD_H) {
          const carried = run?.text ?? "";
          endRun(false);
          closeTable();
          newPage();
          openTable(board, true);
          if (carried) run = { text: carried, top: y };
        }
        const top = y;
        banded += 1;
        drawPart(part, y, band());
        y += part.height;
        if (changed && group) {
          if (top > tableTop + BOARD_H + HEAD_H) {
            doc.setDrawColor(...BLACK);
            doc.setLineWidth(0.6);
            doc.line(MARGIN, top, MARGIN + tableWidth, top);
          }
          run = { text: group, top };
        }
      });
      endRun(true);
      // The rest of the part type's last page: blank rows.
      if (boardIndex === boards.length - 1) {
        while (y + ROW_H <= tableBottom) {
          banded += 1;
          doc.setFillColor(...band());
          doc.rect(MARGIN, y, tableWidth, ROW_H, "F");
          drawColumnLines(y, y + ROW_H);
          y += ROW_H;
        }
      }
      closeTable();
    });
  });

  // Page numbers (after the title sheet).
  const pageCount = doc.getNumberOfPages();
  const firstNumbered = input.titlePage ? 2 : 1;
  for (let page = firstNumbered; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(110, 110, 110);
    doc.text(`${input.projectName} — Production Cutlist${input.footer ? `   ·   ${input.footer}` : ""}`, MARGIN, pageHeight - 14);
    if (input.pageNumbers !== false) {
      doc.text(`Page ${page - firstNumbered + 1} of ${pageCount - firstNumbered + 1}`, pageWidth - MARGIN, pageHeight - 14, { align: "right" });
    }
  }
  return { blob: doc.output("blob"), pageCount };
}
