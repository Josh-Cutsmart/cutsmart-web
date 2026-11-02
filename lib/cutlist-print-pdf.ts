"use client";

import type { jsPDF as JsPdf } from "jspdf";
import { activeLength } from "@/lib/company-formats";
import { formatShapeMm, isCabinetShape, shapeBandingSummary, shapeOuterSize, type CutlistShape } from "@/lib/cutlist-shape";
import { shapeDrawingOps, type ShapeDrawingOp } from "@/lib/cutlist-shape-render";
import { cabinet3dDrawingOps, cabinetPlanDrawingOps, cabinetSettings, cachedCustomCabinetModel, customCabinetSize } from "@/lib/cutlist-cabinet-shape";
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
// - each table ending at its last part (the rest of the page left blank);
// - Custom pieces (shapeOf: a row cut to a shape of its own) at the bottom of the table of the part type picked as what
//   each is (tableOf — the cutlist list's own: its Custom area), under a slim "Custom" bar with how many parts — that
//   part type's page(s) printed for them even when it has none of its own; one with none picked, in a "Custom" section
//   after the rest, as the list's Custom table. Flat pieces first. Each its own row as the others are (a flat piece's
//   Height × Width, a cabinet's Height × Width × Depth — one row, its pieces not listed), how much of it's banded over
//   both Clashing cells ("3.6m" — bandingOf), and its second line as the others' (a cabinet's Base / Wall, top or rails
//   and shelves). Its drawing's on the Drawings page(s) at the end, under a label — A1, A2… in the order they come — its
//   Information's first line saying so (See Image "A1").
// - the Drawings page(s): every Custom piece's drawing in a box of its own, its label big in its top left corner, its
//   name, part type and room beside it — a flat piece's dimensioned drawing (its radii and arrows at its banding —
//   lib/cutlist-shape-render.ts); a custom cabinet's top view (its backs and ends a board thick, its dimensions —
//   lib/cutlist-cabinet-shape.ts) and its 3D view beside it, in the one box. As many across as fit, row after row; a box
//   never split between pages.
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
  // A shaped piece's banding (a custom cabinet's top, bottom and shelves): over both Clashing cells, in place of them.
  banding?: string;
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
  // A Custom part type's piece: the shape it's cut to (null: an ordinary part) — each printed with a drawing of it, at
  // the bottom of the table it's in (tableOf: the part type picked as what it is; "" or not given — the Custom section
  // at the end), and how much of it's banded for its Clashing ("3.6m" — bandingOf).
  shapeOf?: (row: CutlistRow) => CutlistShape | null;
  tableOf?: (row: CutlistRow) => string;
  bandingOf?: (row: CutlistRow) => string;
  // A custom cabinet (its shape a Cabinetry part type's — isCabinetShape): its board thickness (its top view's backs and
  // ends, its 3D view's panels, drawn that thick). null: not one. (Printed as one row, as a Cabinetry row is — its pieces
  // aren't listed.)
  cabinetOf?: (row: CutlistRow) => { thicknessMm: number } | null;
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
// Whether black text reads better on a fill than white does — whichever stands out more from it (WCAG's contrast, from
// its relative luminance): a dark part type's colour gets white text, a light (or lightened) one black.
const linearChannel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const isLight = (rgb: Rgb) => {
  const luminance = 0.2126 * linearChannel(rgb[0]) + 0.7152 * linearChannel(rgb[1]) + 0.0722 * linearChannel(rgb[2]);
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05);
};
// Towards white (keep: how much of the colour stays).
const tint = (rgb: Rgb, keep: number): Rgb => rgb.map((channel) => Math.round(255 - (255 - channel) * keep)) as Rgb;
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
const BLUE: Rgb = [47, 84, 150];
// The zebra rows' grey — dark enough to still show once printed.
const BAND: Rgb = [205, 205, 205];
// (Black, as the rows' own text — labels bold, values plain.)
const DETAIL_TEXT: Rgb = [0, 0, 0];
const LIGHT_LINE: Rgb = [185, 185, 185];
const FALLBACK_COLOUR: Rgb = [203, 213, 225];

// The page (A4 landscape, pt).
const MARGIN = 22;
const HEADER_TOP = 20;
const NOTES_H = 58;
// The header's NOTES box's width — in the middle of the page.
const NOTES_W = 270;
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
// Between one field and the next on a part's second line.
const SEGMENT_GAP = 24;
// The Room column at its widest.
const ROOM_MAX_W = 150;
// The "Doors" / "Drawers" strip's word.
const STRIP_FONT = 6.5;
// A drawer's pieces' names, in from its own.
const PIECE_INDENT = 10;
// Between one thing and the next in the Hinges column's positions.
const HINGE_GAP = 8;
// The Drawings pages' boxes (pt — a drawing's steps' px drawn a point each): each as tall as this, its label's strip
// across its top, the padding in it, the gap between boxes; a flat piece's drawing at most this wide, a custom cabinet's
// top view and 3D view each at most these wide (side by side, `DRAWING_INNER_GAP` apart); the drawings' numbers' size.
const DRAWING_BOX_H = 222;
const DRAWING_LABEL_H = 26;
const DRAWING_PAD = 8;
const DRAWING_GAP = 12;
const DRAWING_FLAT_W = 380;
const DRAWING_PLAN_W = 330;
const DRAWING_3D_W = 280;
const DRAWING_INNER_GAP = 10;
const DRAWING_FONT = 8.5;
// The narrowest a box is (room for its label and its name).
const DRAWING_MIN_W = 200;
// How a custom cabinet's 3D view is turned (the 3D view's own, components/cutlist-cabinet-3d.tsx).
const SHAPE_3D_VIEW = { yaw: -0.6, pitch: 0.5 };
// A table's Custom area's bar, over its Custom pieces.
const CUSTOM_BAR_H = 12;

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

// Where a Custom piece goes among a table's Custom pieces: flat pieces (0) before custom cabinets (1) — a shape with a
// cabinet on it — each kept in the order it comes.
const shapeSortKey = (shape: CutlistShape) => (Boolean((shape as unknown as Record<string, unknown>).cabinet) ? 1 : 0);

// A colour (#RRGGBB) washed towards white — a fill at less than full strength, on the white page.
function faded(color: string, opacity: number): string {
  const rgb = hexToRgb(color);
  if (!rgb || opacity >= 1) return color;
  return `#${tint(rgb, Math.max(0, opacity))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

// A shape's drawing (lib/cutlist-shape-render.ts — its steps in px, y down) drawn as vectors, a px a point, its top left
// at (x, y). (The project page's CNC Cutlist PDF draws its Custom pieces with it too.)
export function drawShapeDrawingOps(doc: JsPdf, ops: ShapeDrawingOp[], x: number, y: number) {
  for (const op of ops) {
    if (op.kind === "path") {
      if (op.points.length < 2) continue;
      const fill = op.fill ? faded(op.fill, op.fillOpacity ?? 1) : "";
      if (!fill && !op.stroke) continue;
      if (fill) doc.setFillColor(fill);
      if (op.stroke) {
        doc.setDrawColor(op.stroke);
        doc.setLineWidth(op.lineWidth ?? 1);
        doc.setLineCap(op.lineCap ?? "butt");
        doc.setLineJoin(op.lineJoin ?? "miter");
      }
      doc.moveTo(x + op.points[0][0], y + op.points[0][1]);
      for (let index = 1; index < op.points.length; index += 1) doc.lineTo(x + op.points[index][0], y + op.points[index][1]);
      if (op.closed) doc.close();
      if (fill && op.stroke) doc.fillStroke();
      else if (fill) doc.fill();
      else doc.stroke();
    } else if (op.kind === "rect") {
      doc.setFillColor(op.fill);
      if (op.stroke) {
        doc.setDrawColor(op.stroke);
        doc.setLineWidth(op.lineWidth ?? 1);
      }
      const style = op.stroke ? "FD" : "F";
      const r = Math.max(0, Math.min(op.r, op.w / 2, op.h / 2));
      if (r > 0) doc.roundedRect(x + op.x, y + op.y, op.w, op.h, r, r, style);
      else doc.rect(x + op.x, y + op.y, op.w, op.h, style);
    } else {
      doc.setFont("helvetica", op.bold ? "bold" : "normal");
      doc.setFontSize(op.size);
      doc.setTextColor(op.color);
      doc.text(op.text, x + op.x, y + op.y, { align: op.align, baseline: "alphabetic" });
    }
  }
  // (Back to the page's own: square ends and joins.)
  doc.setLineCap("butt");
  doc.setLineJoin("miter");
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
// A Custom piece: its own row (its outer Height × Width, no Depth), its banding over both Clashing cells, and its shape.
// A custom cabinet: its own row (its Height × Width × Depth, its banding), its top view under it — no pieces.
function printedPart(
  row: CutlistRow,
  input: CutlistPrintInput,
): {
  own: Values;
  pieces: Values[];
  hinges: Segment[];
  cabinetClash: string;
  shape: CutlistShape | null;
  cabinet?: { thicknessMm: number };
} {
  const shape = input.shapeOf?.(row) ?? null;
  const cabinet = shape && isCabinetShape(shape) ? (input.cabinetOf?.(row) ?? null) : null;
  if (shape && cabinet) {
    const outer = customCabinetSize(shape);
    return {
      own: {
        ...BLANK,
        room: toStr(row.room),
        name: toStr(row.name),
        height: size(toStr(row.height) || formatShapeMm(outer.height)),
        width: size(toStr(row.width) || formatShapeMm(outer.width)),
        depth: size(toStr(row.depth) || formatShapeMm(outer.depth)),
        quantity: toStr(row.quantity),
        information: toStr(row.information),
      },
      pieces: [],
      hinges: [],
      cabinetClash: toStr(input.bandingOf?.(row)),
      shape,
      cabinet: { thicknessMm: cabinet.thicknessMm },
    };
  }
  if (shape) {
    const outer = shapeOuterSize(shape);
    return {
      own: {
        ...BLANK,
        room: toStr(row.room),
        name: toStr(row.name),
        height: size(toStr(row.height) || formatShapeMm(outer.height)),
        width: size(toStr(row.width) || formatShapeMm(outer.width)),
        quantity: toStr(row.quantity),
        information: toStr(row.information),
      },
      pieces: [],
      hinges: [],
      cabinetClash: input.bandingOf ? toStr(input.bandingOf(row)) : shapeBandingSummary(shape),
      shape,
    };
  }
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
      shape: null,
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
    shape: null,
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
  // (A custom cabinet's: Base or Wall, its top or rails, and its shelves. A flat Custom piece: nothing more of its own —
  // it's in its table's Custom area, its drawing on the Drawings page.)
  const shape = input.shapeOf?.(row) ?? null;
  if (shape && isCabinetShape(shape) && input.cabinetOf?.(row)) {
    const settings = cabinetSettings(shape);
    out.push(["Cabinet", settings.kind === "wall" ? "Wall" : "Base"]);
    if (settings.kind !== "wall") out.push(["Top", settings.fullTop ? "Full Top" : "Rails"]);
    const fixed = shelves(settings.fixedShelves, row.fixedShelfDrilling);
    if (fixed) out.push(["Fixed Shelves", fixed]);
    const adjustable = shelves(settings.adjustableShelves, row.adjustableShelfDrilling);
    if (adjustable) out.push(["Adjustable Shelves", adjustable]);
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
  // Part Name's column.
  let nameIndex = 0;
  // Where a part's second line starts: the Height column (the columns before it — Room, Part Name — run on down beside
  // it) — its own table's, as each has its own columns.
  let detailFrom = 0;
  let detailLeft = MARGIN;
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
    const heightIndex = columns.findIndex((column) => column.key === "height");
    detailFrom = heightIndex > 0 ? heightIndex : 0;
    detailLeft = detailFrom > 0 ? lefts[detailFrom] : MARGIN;
  };
  setColumnsFor(rows);
  const columnIndex = (key: ColumnKey) => columns.findIndex((column) => column.key === key);

  // By part type: the company's order first, then any others as they come (as the list's sections).
  const orderOf = (type: string) => {
    const index = input.partTypeOrder.findIndex((name) => name.toLowerCase() === type.toLowerCase());
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  // (A Custom piece: in the section of the part type picked as what it is (tableOf) — at the bottom of its tables, in
  // their Custom area — or, with none, in one Custom section after them all, in the colour of its first one's part type.
  // Flat pieces first.)
  const sections: Array<{ type: string; rows: CutlistRow[]; colourType?: string; custom?: boolean }> = [];
  const customRows: CutlistRow[] = [];
  const sectionFor = (type: string) => {
    const known = sections.find((item) => item.type.toLowerCase() === type.toLowerCase());
    if (known) return known;
    const made = { type, rows: [] as CutlistRow[] };
    sections.push(made);
    return made;
  };
  for (const row of rows) {
    const shape = input.shapeOf?.(row) ?? null;
    const table = shape ? toStr(input.tableOf?.(row)) : "";
    if (shape && !table) {
      customRows.push(row);
      continue;
    }
    sectionFor(table || toStr(row.partType) || "Unassigned").rows.push(row);
  }
  sections.sort((a, b) => orderOf(a.type) - orderOf(b.type));
  if (customRows.length) sections.push({ type: "Custom", rows: customRows, colourType: toStr(customRows[0].partType), custom: true });
  const isCustomRow = (row: CutlistRow) => Boolean(input.shapeOf?.(row));
  const customOrder = (list: CutlistRow[]) =>
    list
      .map((row, index) => ({ row, index, key: shapeSortKey(input.shapeOf?.(row) as CutlistShape) }))
      .sort((a, b) => a.key - b.key || a.index - b.index)
      .map((item) => item.row);
  // A section's boards (as the list shows them), each with its rows — in the order they come.
  const boardsOf = (sectionRows: CutlistRow[]) => {
    const boards: Array<{ label: string; rows: CutlistRow[] }> = [];
    for (const row of sectionRows) {
      const label = input.boardOf(toStr(row.board)) || "No board";
      const board = boards.find((item) => item.label.toLowerCase() === label.toLowerCase());
      if (board) board.rows.push(row);
      else boards.push({ label, rows: [row] });
    }
    return boards;
  };
  // Each Custom piece's drawing's label — A1, A2… in the order they're printed (section by section, board by board, at
  // the bottom of each table) — and the drawings in that order, for the Drawings page(s).
  const labelOf = new Map<CutlistRow, string>();
  for (const section of sections) {
    for (const board of boardsOf(section.rows)) {
      for (const row of customOrder(section.custom ? board.rows : board.rows.filter(isCustomRow))) labelOf.set(row, `A${labelOf.size + 1}`);
    }
  }

  // A line of text cut to fit `width` (with an ellipsis), in the current font.
  const fit = (text: string, width: number) => {
    if (doc.getTextWidth(text) <= width) return text;
    let cut = text;
    while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > width) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  };

  // The page's header: PROJECT CUTLIST and the part type; the NOTES box, in the middle of the page; the company and the
  // project, taking the room from the box to the right edge.
  const drawHeader = (partType: string) => {
    const leftW = 200;
    const right = pageWidth - MARGIN;
    const boxW = NOTES_W;
    const boxX = (pageWidth - boxW) / 2;
    const rightW = right - (boxX + boxW) - 24;
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

    doc.setTextColor(...BLUE);
    // (A long company name a little smaller to fit, before it's cut short.)
    let companySize = 17;
    doc.setFontSize(companySize);
    while (companySize > 12 && doc.getTextWidth(input.companyName || "") > rightW) {
      companySize -= 0.5;
      doc.setFontSize(companySize);
    }
    doc.text(fit(input.companyName || "", rightW), right, HEADER_TOP + 16, { align: "right" });
    doc.line(right - rightW, HEADER_TOP + 23, right, HEADER_TOP + 23);
    doc.setTextColor(...BLACK);
    doc.setFontSize(13);
    doc.text(fit(input.projectName || "Project", rightW), right, HEADER_TOP + 43, { align: "right" });

    doc.setDrawColor(...BLUE);
    doc.setLineWidth(1.2);
    doc.rect(boxX, HEADER_TOP, boxW, NOTES_H, "S");
    doc.setTextColor(...BLUE);
    doc.setFontSize(9);
    doc.text("NOTES:", boxX + 8, HEADER_TOP + 13);
    // (Its left column as wide as its notes need — their values are short — up to half; Hinge Type, the long one, the rest.)
    doc.setFontSize(8.5);
    const noteW = (label: string, value: string) => {
      doc.setFont("helvetica", "bold");
      const labelW = doc.getTextWidth(`${label}: `);
      doc.setFont("helvetica", "normal");
      return labelW + doc.getTextWidth(value || "-");
    };
    const leftColW = Math.min(
      (boxW - 24) / 2,
      Math.max(noteW("Carcass Thickness", input.notes.carcassThickness), noteW("Base Cab Height", input.notes.baseCabHeight)) + 2,
    );
    const rightColW = boxW - 24 - leftColW;
    const note = (label: string, value: string, x: number, y: number, colW: number, maxLines = 3) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...BLACK);
      doc.text(`${label}:`, x, y);
      const labelW = doc.getTextWidth(`${label}: `);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(value || "-", Math.max(20, colW - labelW)) as string[];
      doc.text(lines.length > maxLines ? [...lines.slice(0, maxLines - 1), fit(lines.slice(maxLines - 1).join(" "), Math.max(20, colW - labelW))] : lines, x + labelW, y);
    };
    note("Carcass Thickness", input.notes.carcassThickness, boxX + 8, HEADER_TOP + 28, leftColW);
    note("Base Cab Height", input.notes.baseCabHeight, boxX + 8, HEADER_TOP + 40, leftColW);
    // (One line — Tall Cab Height under it.)
    note("Hinge Type", input.notes.hingeType, boxX + 16 + leftColW, HEADER_TOP + 28, rightColW, 1);
    // (Under Hinge Type, beside Base Cab Height.)
    note("Tall Cab Height", input.notes.tallCabHeight, boxX + 16 + leftColW, HEADER_TOP + 40, rightColW);
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
    rule(MARGIN, y + BOARD_H, MARGIN + tableWidth, y + BOARD_H);
  };

  // The tables' lines — every divider, 0.5 wide (black; the light one between Hinges' side and positions) — queued as
  // they're laid out and drawn together as each table (or its page) closes: over every shading, so none is half painted
  // over by what's drawn under it, and each right on its edge.
  let rules: Array<{ x1: number; y1: number; x2: number; y2: number; light: boolean }> = [];
  const rule = (x1: number, y1: number, x2: number, y2: number, light = false) => {
    rules.push({ x1, y1, x2, y2, light });
  };
  const drawRules = () => {
    doc.setLineWidth(0.5);
    for (const line of rules) {
      doc.setDrawColor(...(line.light ? LIGHT_LINE : BLACK));
      doc.line(line.x1, line.y1, line.x2, line.y2);
    }
    rules = [];
  };

  // A table's Custom area's bar, over its Custom pieces: "Custom" (and that it carries on from the page before), and how
  // many parts — in a pale shade of the part type's colour, as the list's Custom heading.
  const drawCustomBar = (colour: Rgb, parts: number, continued: boolean, y: number) => {
    const fill = tint(colour, 0.35);
    doc.setFillColor(...fill);
    doc.rect(MARGIN, y, tableWidth, CUSTOM_BAR_H, "F");
    doc.setTextColor(...(isLight(fill) ? BLACK : WHITE));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT);
    doc.text(continued ? "Custom (continued)" : "Custom", MARGIN + PAD_X + 2, baselineFor(y, CUSTOM_BAR_H, 1, FONT));
    doc.setFont("helvetica", "normal");
    doc.text(`${parts} part${parts === 1 ? "" : "s"}`, MARGIN + tableWidth - PAD_X - 2, baselineFor(y, CUSTOM_BAR_H, 1, FONT), { align: "right" });
    rule(MARGIN, y, MARGIN + tableWidth, y);
    rule(MARGIN, y + CUSTOM_BAR_H, MARGIN + tableWidth, y + CUSTOM_BAR_H);
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
    rule(MARGIN, y + HEAD_H, MARGIN + tableWidth, y + HEAD_H);
    lefts.forEach((x, index) => {
      if (index > 0 && !SECOND_OF_PAIR.includes(columns[index].key)) rule(x, y, x, y + HEAD_H);
    });
  };

  // The lines between the columns, from `top` to `bottom` — only up to `upTo` (the second line: just its first ones),
  // and not at the left edges of `skip`'s columns.
  // (Between Hinges' side and positions: a lighter one.)
  const drawColumnLines = (top: number, bottom: number, upTo = columns.length, skip: number[] = []) => {
    for (let index = 1; index < upTo; index += 1) {
      if (skip.includes(index)) continue;
      rule(lefts[index], top, lefts[index], bottom, columns[index].key === "hinges");
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
  // A Custom piece's drawing, for its box on the Drawings page(s) — only as wide as it needs (trimWidth). A custom
  // cabinet's: its top view, its backs and ends `cabinetThickness` thick.
  const drawingOf = (shape: CutlistShape, width: number, height: number, cabinetThickness?: number) => {
    const options = { width, height, fontSize: DRAWING_FONT, background: "#FFFFFF", trimWidth: true };
    return cabinetThickness !== undefined ? cabinetPlanDrawingOps(shape, { ...options, thicknessMm: cabinetThickness }) : shapeDrawingOps(shape, options);
  };
  // ...and a custom cabinet's 3D view (in its part type's colour, plain — no role colours or labels) — without its doors,
  // on paper.
  const view3dOf = (row: CutlistRow, shape: CutlistShape, thicknessMm: number, width: number, height: number) => {
    const colour = input.partTypeColors[toStr(row.partType)] ?? "#CBD5E1";
    const model = cachedCustomCabinetModel(shape, thicknessMm);
    return cabinet3dDrawingOps({ ...model, prisms: model.prisms.filter((prism) => prism.kind !== "door") }, SHAPE_3D_VIEW, {
      width,
      height,
      color: colour,
      fontSize: DRAWING_FONT,
      showRoles: false,
      // (Only as wide as the cabinet in it needs.)
      trimWidth: true,
    });
  };
  // A part laid out: its row (or a drawer's: its own row, then its pieces'), its second line's words under its own row,
  // and how high it all is. (A Custom piece: its Information's first line where its drawing is — See Image "A1".)
  const layoutPart = (row: CutlistRow) => {
    const printed = printedPart(row, input);
    const label = labelOf.get(row);
    if (label) printed.own.information = [`See Image "${label}"`, printed.own.information].filter(Boolean).join("\n");
    const before: TableLine[] = [];
    const after: TableLine[] = [];
    if (printed.cabinet) {
      // (A custom cabinet: one row with its sizes and banding, as a Cabinetry row.)
      before.push(tableLine(printed.own, { axis: grainAxis(row), mergedClash: printed.cabinetClash }));
    } else if (printed.pieces.length) {
      before.push(tableLine(printed.own, { bold: true, nameSpan: true }));
      for (const piece of printed.pieces) after.push(tableLine(piece, { indent: PIECE_INDENT }));
    } else {
      const hingesIndex = columnIndex("hinges");
      const hinges = hingesIndex < 0 ? [] : layoutSegments(doc, printed.hinges, widths[hingesIndex] - PAD_X * 2, FONT, HINGE_GAP);
      before.push(tableLine(printed.own, { axis: grainAxis(row), mergedClash: printed.cabinetClash, hinges }));
    }
    const segments = detailSegments(row, input);
    // (Its second line from the Height column across, under a line closing off its row's columns there — its Room and
    // Part Name carrying on down beside it, taller boxes.)
    const detailLines = segments.length ? layoutSegments(doc, segments, MARGIN + tableWidth - detailLeft - PAD_X * 2) : [];
    // (As tall as a row — taller only if its words wrap onto more lines.)
    const detailH = detailLines.length ? Math.max(ROW_H, detailLines.length * DETAIL_FONT * LINE + 4.4) : 0;
    const height = [...before, ...after].reduce((sum, line) => sum + line.height, 0) + detailH;
    // How many parts it is: its pieces', or its own quantity.
    const parts = printed.pieces.length
      ? printed.pieces.reduce((sum, piece) => sum + (Number.parseInt(piece.quantity, 10) || 0), 0)
      : Number(row.quantity) || 0;
    return { before, after, detailLines, detailH, height, parts };
  };

  // A table row, from `y`. (`tall`: the columns before the second line's start — their text centred down the row and its
  // second line together, `tall` high. Its Room isn't written here — drawPart writes it, centred down the whole part.)
  const drawLine = (line: TableLine, y: number, tall = 0) => {
    doc.setTextColor(...BLACK);
    columns.forEach((column, index) => {
      const cell = line.cells[index];
      if (!cell.length || !cell[0] || column.key === "room") return;
      const grained = (column.key === "height" || column.key === "width" || column.key === "depth") && column.key === line.axis;
      const name = index === nameIndex;
      doc.setFont("helvetica", grained || (name && line.bold) ? "bold" : "normal");
      doc.setFontSize(FONT);
      const x = column.align === "center" ? lefts[index] + widths[index] / 2 : lefts[index] + PAD_X + (name ? (line.indent ?? 0) : 0);
      const baseline = baselineFor(y, tall && index < detailFrom ? tall : line.height, cell.length, FONT);
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
    rule(x, top, x + w, top);
    rule(x, bottom, x + w, bottom);
    rule(x + w, top, x + w, bottom);
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
    // Its Room centred down the whole part — its own row, its second line and its pieces.
    const roomIndex = columnIndex("room");
    const roomCell = roomIndex >= 0 ? part.before[0]?.cells[roomIndex] : undefined;
    if (roomCell?.length && roomCell[0]) {
      doc.setTextColor(...BLACK);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(FONT);
      doc.text(roomCell, lefts[roomIndex] + PAD_X, baselineFor(y, part.height, roomCell.length, FONT));
    }
    let top = y;
    for (const [lineIndex, line] of part.before.entries()) {
      // (Its own row, with a second line under it: its Part Name centred down both.)
      drawLine(line, top, part.detailH > 0 && lineIndex === part.before.length - 1 ? line.height + part.detailH : 0);
      // (A drawer's own row — its name over its sizes, quantity and clashing: a line above and below it across them.)
      if (line.nameSpan && spanned.length) {
        const from = lefts[nameIndex];
        const to = Math.max(...spanned.map((index) => lefts[index] + widths[index]));
        rule(from, top, to, top);
        rule(from, top + line.height, to, top + line.height);
      }
      top += line.height;
    }
    if (part.detailH > 0) {
      doc.setFontSize(DETAIL_FONT);
      doc.setTextColor(...DETAIL_TEXT);
      // (Its lines centred up and down in it.)
      const textTop = top + (part.detailH - part.detailLines.length * DETAIL_FONT * LINE) / 2;
      part.detailLines.forEach((line, lineIndex) => {
        const baseline = textTop + lineIndex * DETAIL_FONT * LINE + DETAIL_FONT * 0.86;
        line.forEach((word) => {
          doc.setFont("helvetica", word.bold ? "bold" : "normal");
          doc.text(word.text, detailLeft + PAD_X + word.x, baseline);
        });
      });
      // (A line across from the Height column between its row and its second line — its row's columns there stop at it;
      // none through this — as the column lines are, black at 0.5. The columns before it carry on down beside it.)
      rule(detailLeft, top, MARGIN + tableWidth, top);
      drawColumnLines(top, top + part.detailH, detailFrom + 1);
      top += part.detailH;
      // (...and one under it, closing the part off from the next — from the Doors / Drawers strip's edge, when the table has
      // one: the strip runs on unbroken down its doors or drawer fronts.)
      const stripIndex = columnIndex("group");
      rule(stripIndex >= 0 ? lefts[stripIndex] + widths[stripIndex] : MARGIN, top, MARGIN + tableWidth, top);
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
    const colour = hexToRgb(input.partTypeColors[section.colourType ?? section.type] ?? "") ?? FALLBACK_COLOUR;
    const headingColour = tint(colour, 0.55);
    // Its boards (as the list shows them), each with its parts — in the order they come.
    const boards = boardsOf(section.rows);
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
      drawRules();
      doc.setDrawColor(...BLACK);
      doc.setLineWidth(0.8);
      doc.rect(MARGIN, tableTop, tableWidth, y - tableTop, "S");
    };

    newPage();
    boards.forEach((board, boardIndex) => {
      // (Its own parts — then, a part type's table, its Custom pieces under their bar. The Custom section's: all of them,
      // no bar.)
      const ownRows = section.custom ? [] : board.rows.filter((row) => !isCustomRow(row));
      const areaRows = customOrder(section.custom ? board.rows : board.rows.filter(isCustomRow));
      const parts: Array<{ row: CutlistRow; group: string; area?: boolean }> = [
        ...tableParts(ownRows),
        ...areaRows.map((row) => ({ row, group: "", area: !section.custom })),
      ];
      const areaParts = areaRows.reduce((sum, row) => sum + layoutPart(row).parts, 0);
      let areaOpen = false;
      // Under the last one, on the same page — when its top and its first part fit there.
      if (boardIndex > 0) {
        y += TABLE_GAP;
        if (y + BOARD_H + HEAD_H + layoutPart(parts[0].row).height > tableBottom) newPage();
      }
      openTable(board, false);
      parts.forEach(({ row, group, area }) => {
        const part = layoutPart(row);
        // Drawer fronts after doors: the doors' run ends — then a line across between them, and the drawer fronts' run.
        const changed = group !== (run?.text ?? "");
        if (changed) endRun(true);
        // (The first of its Custom pieces: their bar over it, kept on the same page as it.)
        const barH = area && !areaOpen ? CUSTOM_BAR_H : 0;
        // Both of its rows on this page — or on the next (its strip's run carrying on there; its Custom area's bar again,
        // continued).
        if (y + barH + part.height > tableBottom && y > tableTop + BOARD_H + HEAD_H) {
          const carried = run?.text ?? "";
          endRun(false);
          closeTable();
          newPage();
          openTable(board, true);
          if (carried) run = { text: carried, top: y };
          if (area && areaOpen) {
            drawCustomBar(colour, areaParts, true, y);
            y += CUSTOM_BAR_H;
            banded = 0;
          }
        }
        if (barH) {
          drawCustomBar(colour, areaParts, false, y);
          y += CUSTOM_BAR_H;
          banded = 0;
          areaOpen = true;
        }
        const top = y;
        banded += 1;
        drawPart(part, y, band());
        y += part.height;
        if (changed && group) {
          if (top > tableTop + BOARD_H + HEAD_H) rule(MARGIN, top, MARGIN + tableWidth, top);
          run = { text: group, top };
        }
      });
      endRun(true);
      // (The table ends at its last part — the rest of the page left blank.)
      closeTable();
    });
  });

  // The Drawings page(s): each Custom piece's drawing in a box of its own, in its label's order — as many across as fit
  // (each box as wide as what's in it needs), row after row, onto another page when the next row won't fit.
  if (labelOf.size) {
    const right = MARGIN + tableWidth;
    const drawingH = DRAWING_BOX_H - DRAWING_LABEL_H - DRAWING_PAD;
    let x = MARGIN;
    let y = TABLE_TOP;
    const newDrawingsPage = () => {
      if (pageOpen) doc.addPage();
      pageOpen = true;
      drawHeader("Drawings");
      x = MARGIN;
      y = TABLE_TOP;
    };
    newDrawingsPage();
    for (const [row, label] of labelOf) {
      const shape = input.shapeOf?.(row);
      if (!shape) continue;
      const cabinet = isCabinetShape(shape) ? (input.cabinetOf?.(row) ?? null) : null;
      // (A custom cabinet: its top view and its 3D view, side by side in the one box.)
      const plan = drawingOf(shape, cabinet ? DRAWING_PLAN_W : DRAWING_FLAT_W, drawingH, cabinet?.thicknessMm);
      const view3d = cabinet ? view3dOf(row, shape, cabinet.thicknessMm, DRAWING_3D_W, drawingH) : null;
      const contentW = plan.width + (view3d ? DRAWING_INNER_GAP + view3d.width : 0);
      const boxW = Math.min(tableWidth, Math.max(DRAWING_MIN_W, contentW + DRAWING_PAD * 2));
      // Beside the last box — or under them, or on a new page.
      if (x > MARGIN && x + boxW > right) {
        x = MARGIN;
        y += DRAWING_BOX_H + DRAWING_GAP;
      }
      if (y + DRAWING_BOX_H > tableBottom) newDrawingsPage();
      // Its box.
      doc.setDrawColor(...BLACK);
      doc.setLineWidth(0.8);
      doc.rect(x, y, boxW, DRAWING_BOX_H, "S");
      // Its label, big, on its part type's colour in the top left corner — then its name, part type and room.
      const colour = hexToRgb(input.partTypeColors[toStr(row.partType)] ?? "") ?? FALLBACK_COLOUR;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      const labelW = doc.getTextWidth(label) + 14;
      doc.setFillColor(...colour);
      doc.rect(x, y, labelW, DRAWING_LABEL_H - 4, "F");
      doc.setTextColor(...(isLight(colour) ? BLACK : WHITE));
      doc.text(label, x + 7, baselineFor(y, DRAWING_LABEL_H - 4, 1, 14));
      doc.setDrawColor(...BLACK);
      doc.setLineWidth(0.5);
      doc.line(x + labelW, y, x + labelW, y + DRAWING_LABEL_H - 4);
      doc.line(x, y + DRAWING_LABEL_H - 4, x + labelW, y + DRAWING_LABEL_H - 4);
      const captionX = x + labelW + 8;
      const captionW = x + boxW - DRAWING_PAD - captionX;
      doc.setTextColor(...BLACK);
      doc.setFontSize(8.5);
      const name = fit(toStr(row.name) || "Part", captionW);
      doc.text(name, captionX, y + 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      const details = [toStr(row.partType), toStr(row.room)].filter(Boolean).join("  ·  ");
      if (details) doc.text(fit(details, captionW), captionX, y + 19);
      // Its drawing(s), centred across the box.
      const drawX = x + (boxW - contentW) / 2;
      const drawY = y + DRAWING_LABEL_H;
      drawShapeDrawingOps(doc, plan.ops, drawX, drawY);
      if (view3d) drawShapeDrawingOps(doc, view3d.ops, drawX + plan.width + DRAWING_INNER_GAP, drawY);
      x += boxW + DRAWING_GAP;
    }
  }

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
