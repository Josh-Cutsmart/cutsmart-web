"use client";

import type { jsPDF as JsPdf } from "jspdf";
import qrcode from "qrcode-generator";
import { formatShapeMetres, placeShapeLabels, segmentArcPoints, shapeGeometry, type CutlistShape, type ShapePoint } from "@/lib/cutlist-shape";
import { shapeBandedPolylines, shapeOutlinePolyline } from "@/lib/cutlist-shape-render";
import type { PrintTitleLogo } from "@/lib/print-title-page";

// Production › Labels: a sticky label for every piece the workshop cuts — one per piece (a part's quantity is that
// many labels; a cabinet's, drawer's or door's own pieces each have theirs, under its ID). Each label has:
//  - the part's ID (as the CNC Cutlist and the Nesting sheets number it) in a black tile, its name, and what it's part
//    of / its room / its part type; the company's logo top right;
//  - the piece's outline, to scale, with an X on each edge that's clashed and its clashing (1L1S) under it — a door's
//    hinges drawn on it too, each with where it goes, and marked Front (they're drilled from the other side);
//  - its size, each number with which it is (H, W, D) over it; its board; its information lines;
//  - along the bottom: the project and who it's for, and which of its copies it is (2 of 4);
//  - with qrUrl: a QR code in the bottom right of its body — scanned with a phone's camera, it opens the part in its
//    project (Production › Labels' "QR codes").
// Laid out once (layoutPartLabel: plain shapes and text, in mm, from the label's top left) and drawn from that both on
// screen (components/part-label.tsx) and into what prints them, so they're always the same: printed, as many as fit whatever paper's
// picked in the print window (partLabelsPrintHtml); downloaded, a PDF of one label a page, the page the label's size, or as many as fit
// on each A4 sheet (labelSheetLayout). Black and grey only: label printers are mostly thermal, black on white.

export type LabelSize = { id: string; name: string; width: number; height: number };

// The usual label printers' rolls (width × height, as the label comes out of the printer).
export const LABEL_SIZES: LabelSize[] = [
  { id: "100x50", name: "100 × 50 mm", width: 100, height: 50 },
  { id: "100x75", name: "100 × 75 mm", width: 100, height: 75 },
  { id: "100x100", name: "100 × 100 mm", width: 100, height: 100 },
  { id: "102x152", name: "4 × 6 in (102 × 152 mm)", width: 102, height: 152 },
  { id: "76x51", name: "3 × 2 in (76 × 51 mm)", width: 76, height: 51 },
  { id: "62x100", name: "62 × 100 mm", width: 62, height: 100 },
];
export const DEFAULT_LABEL_SIZE_ID = "100x75";
// The size last picked, on this device.
export const LABEL_SIZE_STORAGE_KEY = "cutsmart_part_label_size";

// A PDF's layout: a label printer's roll (one label a page, the page the label's size), or filling A4 sheets.
export type LabelPrintLayout = "roll" | "a4";

const A4_SHORT_MM = 210;
const A4_LONG_MM = 297;
// What an ordinary printer can't reach, all round.
const SHEET_MARGIN_MM = 5;

// Labels on an A4 sheet: as many of this size as fit, upright on the page, whichever way round the page holds the most (upright, if
// they're the same). In the middle of the page, edge to edge.
export function labelSheetLayout(size: LabelSize) {
  const fit = (pageW: number, pageH: number) => ({
    pageW,
    pageH,
    columns: Math.max(1, Math.floor((pageW - 2 * SHEET_MARGIN_MM) / size.width)),
    rows: Math.max(1, Math.floor((pageH - 2 * SHEET_MARGIN_MM) / size.height)),
  });
  const upright = fit(A4_SHORT_MM, A4_LONG_MM);
  const sideways = fit(A4_LONG_MM, A4_SHORT_MM);
  const best = sideways.columns * sideways.rows > upright.columns * upright.rows ? sideways : upright;
  return {
    ...best,
    orientation: best === upright ? ("portrait" as const) : ("landscape" as const),
    perSheet: best.columns * best.rows,
    left: (best.pageW - best.columns * size.width) / 2,
    top: (best.pageH - best.rows * size.height) / 2,
  };
}

export function labelSizeById(id: string | null | undefined): LabelSize {
  return LABEL_SIZES.find((size) => size.id === id) ?? LABEL_SIZES.find((size) => size.id === DEFAULT_LABEL_SIZE_ID) ?? LABEL_SIZES[0];
}

export type LabelEdge = "top" | "right" | "bottom" | "left";

export type LabelHingeMark = { at: number; from: "start" | "end"; text: string };

// A door's hinges as the label shows them, however they were entered: the one nearest each end measured from that end, so a 500 door's
// Up 100 and Up 400 read 100 and 100, one from each end. Hinges between those stay measured as entered. A door with just one: from its
// nearer end. Any that's off the door (or a door with no size): left as entered, to be seen as it was typed.
export function hingeMarksFromTheirEnds(marks: LabelHingeMark[], lengthMm: number, textOf: (mm: number) => string): LabelHingeMark[] {
  const placed = marks.map((mark) => ({ mark, along: mark.from === "start" ? mark.at : lengthMm - mark.at }));
  if (!(lengthMm > 0) || placed.some(({ along }) => !(along >= 0 && along <= lengthMm))) return marks;
  const measuredFrom = (mark: LabelHingeMark, along: number, from: "start" | "end"): LabelHingeMark => {
    if (mark.from === from) return mark;
    const at = Math.round((from === "start" ? along : lengthMm - along) * 10) / 10;
    return { at, from, text: textOf(at) };
  };
  placed.sort((a, b) => a.along - b.along);
  if (placed.length === 1) {
    const { mark, along } = placed[0];
    const nearer = along === lengthMm - along ? mark.from : along < lengthMm - along ? "start" : "end";
    return [measuredFrom(mark, along, nearer)];
  }
  return placed.map(({ mark, along }, index) => {
    if (index === 0) return measuredFrom(mark, along, "start");
    if (index === placed.length - 1) return measuredFrom(mark, along, "end");
    return mark;
  });
}

export type PartLabel = {
  key: string;
  // Its part (its cutlist row) — what the Labels sidebar lists, and switches all of its labels off and on by — and that
  // part's name (a cabinet's, for each of its pieces).
  partKey: string;
  partName: string;
  // Its part's ID — a cabinet's (drawer's, door's) pieces all its own.
  id: string;
  name: string;
  // What it's a piece of (a cabinet, a drawer, a door's row), when it's one.
  parentName: string;
  room: string;
  partType: string;
  // Its outline: up the label, and across it (mm).
  tallMm: number;
  wideMm: number;
  // Its sizes as the cutlist has them, each with which it is: H 720 × W 450.
  sizes: Array<{ axis: string; value: string }>;
  board: string;
  // Which way its grain runs on the outline.
  grain: "tall" | "wide" | null;
  // The edges clashed (an X on each), and its clashing as the cutlist writes it.
  clashed: LabelEdge[];
  clashCode: string;
  // A door's hinges: the edge they're on, its side (LH, RH, Top), and each — how far along (mm) from that edge's start
  // (its top, or its left on a top-hinged door) or its end, and that distance as written (see hingeMarksFromTheirEnds). Each has an
  // arrow on the door to the end it's measured from.
  hinges: { side: LabelEdge; tag: string; marks: LabelHingeMark[] } | null;
  info: string[];
  copy: number;
  copies: number;
  projectName: string;
  assignedTo: string;
  // Its QR code's link (none: no QR code) — the part in its project (/projects/<id>?part=<row>).
  qrUrl?: string;
  // A Custom piece: the shape it's cut to (lib/cutlist-shape.ts) — drawn as its real outline (its x across the label,
  // its y down it, onto wideMm × tallMm), its banded runs marked as clashed edges are. (Its clashed / clashCode empty.)
  shape?: CutlistShape | null;
  // ...and each of its sides' length end to end, by edge, as the cutlist writes lengths (shapeSideLengthsMm gives them in mm).
  shapeSides?: string[];
};

// A shape's sides' lengths (mm), end to end, by edge. None if it isn't a shape that can be drawn.
export function shapeSideLengthsMm(shape: CutlistShape | null | undefined): number[] {
  if (!shape) return [];
  try {
    return shapeGeometry(shape).edges.map((edge) => edge.vertexLength);
  } catch {
    return [];
  }
}

// The edges a clashing's long / short edges are: a tall piece's long edges its sides, a wide one's its top and bottom —
// one of them the right / bottom one (so 1L1S is a corner: its two edges meeting there), two both.
export function clashedEdgesFor(clashing: string, tallMm: number, wideMm: number): { edges: LabelEdge[]; code: string } {
  let long = 0;
  let short = 0;
  for (const match of String(clashing || "").toUpperCase().matchAll(/([12])\s*([LS])/g)) {
    if (match[2] === "L") long = Math.max(long, Number(match[1]));
    else short = Math.max(short, Number(match[1]));
  }
  const tall = tallMm > wideMm;
  const longEdges: LabelEdge[] = tall ? ["right", "left"] : ["bottom", "top"];
  const shortEdges: LabelEdge[] = tall ? ["bottom", "top"] : ["right", "left"];
  return {
    edges: [...longEdges.slice(0, long), ...shortEdges.slice(0, short)],
    code: `${long ? `${long}L` : ""}${short ? `${short}S` : ""}`,
  };
}

export type LabelOp =
  | { kind: "rect"; x: number; y: number; w: number; h: number; radius?: number; fill?: string; stroke?: string; lineWidth?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; lineWidth: number }
  | { kind: "circle"; cx: number; cy: number; r: number; stroke: string; lineWidth: number }
  // y: the text's baseline.
  | { kind: "text"; x: number; y: number; text: string; size: number; bold?: boolean; color: string; align?: "left" | "center" | "right" }
  | { kind: "logo"; x: number; y: number; w: number; h: number };

// mm in a point (font sizes are in points).
export const LABEL_PT = 25.4 / 72;
const INK = "#000000";
const SOFT = "#454545";
const RULE = "#8C8C8C";

// A text's width (mm) — measured as Arial, which is Helvetica's (the PDF's font's) metrics exactly.
let measureContext: CanvasRenderingContext2D | null | undefined;
export function measureLabelText(text: string, sizePt: number, bold = false): number {
  if (measureContext === undefined) {
    measureContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (!measureContext) return text.length * sizePt * LABEL_PT * 0.55;
  measureContext.font = `${bold ? "bold " : ""}100px Arial, Helvetica, sans-serif`;
  return (measureContext.measureText(text).width / 100) * sizePt * LABEL_PT;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Cut to fit (… when it's cut).
function fitText(text: string, maxWidth: number, sizePt: number, bold = false): string {
  if (maxWidth <= 0) return "";
  if (measureLabelText(text, sizePt, bold) <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measureLabelText(`${text.slice(0, mid).trimEnd()}…`, sizePt, bold) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? `${text.slice(0, low).trimEnd()}…` : "";
}

// Broken into lines that fit (a word too long for one: cut) — at most `maxLines`, the last cut (…) if there's more.
// (maxWidth can be each line's own, by its number: a line beside the QR code has less room than one above it.)
function wrapText(text: string, maxWidth: number | ((lineIndex: number) => number), sizePt: number, bold = false, maxLines = Infinity): string[] {
  const widthOf = (lineIndex: number) => (typeof maxWidth === "number" ? maxWidth : maxWidth(lineIndex));
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measureLabelText(next, sizePt, bold) <= widthOf(lines.length) || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fitText(lines.slice(maxLines - 1).join(" "), widthOf(maxLines - 1), sizePt, bold);
    return kept;
  }
  return lines.map((each, index) => fitText(each, widthOf(index), sizePt, bold));
}

export function layoutPartLabel(label: PartLabel, size: LabelSize, logo: { width: number; height: number } | null): LabelOp[] {
  const W = size.width;
  const H = size.height;
  const ops: LabelOp[] = [];
  // Everything's size goes with the label's (a 100 × 50 label: 1).
  const k = clamp(Math.sqrt((W * H) / 5000), 0.82, 1.45);
  const m = clamp(Math.min(W, H) * 0.05, 2.5, 4);
  const portrait = H > W * 1.1;
  const addText = (
    text: string,
    x: number,
    y: number,
    sizePt: number,
    options: { bold?: boolean; color?: string; align?: "left" | "center" | "right" } = {},
  ) => {
    if (!text) return;
    ops.push({ kind: "text", x, y, text, size: sizePt, bold: options.bold, color: options.color ?? INK, align: options.align });
  };
  const addLine = (x1: number, y1: number, x2: number, y2: number, lineWidth: number, stroke = INK) =>
    ops.push({ kind: "line", x1, y1, x2, y2, stroke, lineWidth });

  // ---- The top: its ID in a black tile, its name and what it is, the logo.
  const idSize = 15 * k;
  const headH = idSize * LABEL_PT * 1.45;
  const idText = label.id || "–";
  const badgeW = Math.max(headH, measureLabelText(idText, idSize, true) + 3.6 * k);
  ops.push({ kind: "rect", x: m, y: m, w: badgeW, h: headH, radius: 1.3 * k, fill: INK });
  addText(idText, m + badgeW / 2, m + headH / 2 + idSize * LABEL_PT * 0.355, idSize, { bold: true, color: "#FFFFFF", align: "center" });
  let headRight = W - m;
  if (logo && logo.width > 0 && logo.height > 0) {
    const scale = Math.min((W * (portrait ? 0.34 : 0.24)) / logo.width, headH / logo.height);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    ops.push({ kind: "logo", x: W - m - lw, y: m + (headH - lh) / 2, w: lw, h: lh });
    headRight = W - m - lw - 2.5 * k;
  }
  const nameX = m + badgeW + 2.2 * k;
  const nameW = headRight - nameX;
  const nameSize = 11 * k;
  const subSize = 7.2 * k;
  addText(fitText(label.name || label.partType || "Part", nameW, nameSize, true), nameX, m + nameSize * LABEL_PT * 0.92, nameSize, { bold: true });
  const sub = [label.parentName, label.room, label.partType].filter(Boolean).join(" · ");
  addText(fitText(sub, nameW, subSize), nameX, m + headH - 0.5 * k, subSize, { color: SOFT });
  const divider = m + headH + 1.6 * k;
  addLine(m, divider, W - m, divider, 0.25, RULE);

  // ---- The bottom: the project and who it's for; which copy.
  const footSize = 7.5 * k;
  const footBase = H - m - 0.2;
  const footRule = footBase - footSize * LABEL_PT * 0.72 - 1.6 * k;
  addLine(m, footRule, W - m, footRule, 0.25, RULE);
  const copyText = label.copies > 1 ? `${label.copy} of ${label.copies}` : "";
  const copyW = copyText ? measureLabelText(copyText, footSize, true) + 3 * k : 0;
  addText(copyText, W - m, footBase, footSize, { bold: true, align: "right" });
  const footW = W - 2 * m - copyW;
  const projectW = measureLabelText(label.projectName, footSize, true);
  const personText = label.assignedTo ? `  ·  ${label.assignedTo}` : "";
  const personW = measureLabelText(personText, footSize);
  const projectShown = fitText(label.projectName, projectW + personW <= footW ? projectW : Math.max(footW * 0.6, footW - personW), footSize, true);
  addText(projectShown, m, footBase, footSize, { bold: true });
  const projectShownW = measureLabelText(projectShown, footSize, true);
  addText(fitText(personText, footW - projectShownW, footSize), m + projectShownW, footBase, footSize, { color: SOFT });

  // ---- The middle: the outline beside (on a tall label: over) its sizes, board and information — and its QR code
  // (if it has one) in the bottom right corner, just the details level with it going round it.
  const bodyTop = divider + 2 * k;
  const bodyBottom = footRule - 2 * k;
  const qr = label.qrUrl ? qrModules(label.qrUrl) : null;
  if (portrait) {
    const diagramH = (bodyBottom - bodyTop) * 0.42;
    drawOutline(ops, label, { x: m, y: bodyTop, w: W - 2 * m, h: diagramH }, k);
    const detailsY = bodyTop + diagramH + 2.5 * k;
    const qrSize = qr ? clamp(Math.min(bodyBottom - detailsY, (W - 2 * m) * 0.36), 0, QR_MOST_MM) : 0;
    const qrShown = qr && qrSize >= QR_LEAST_MM;
    if (qrShown) drawQr(ops, qr, W - m - qrSize, bodyBottom - qrSize, qrSize);
    const qrCorner = qrShown ? { left: W - m - qrSize, top: bodyBottom - qrSize } : null;
    drawDetails(ops, label, { x: m, y: detailsY, w: W - 2 * m, bottom: bodyBottom }, k, 13 * k, addText, qrCorner);
  } else {
    const diagramW = (W - 2 * m) * 0.4;
    drawOutline(ops, label, { x: m, y: bodyTop, w: diagramW, h: bodyBottom - bodyTop }, k);
    const detailsX = m + diagramW + 3.5 * k;
    const qrSize = qr ? clamp(Math.min(bodyBottom - bodyTop, (W - m - detailsX) * 0.42), 0, QR_MOST_MM) : 0;
    const qrShown = qr && qrSize >= QR_LEAST_MM;
    if (qrShown) drawQr(ops, qr, W - m - qrSize, bodyBottom - qrSize, qrSize);
    const qrCorner = qrShown ? { left: W - m - qrSize, top: bodyBottom - qrSize } : null;
    drawDetails(ops, label, { x: detailsX, y: bodyTop, w: W - m - detailsX, bottom: bodyBottom }, k, 12 * k, addText, qrCorner);
  }
  return ops;
}

// A QR code's size on a label: small enough to leave its details the room, big enough for a phone to read off a label printer's
// dots. Under the least, none.
const QR_MOST_MM = 15;
const QR_LEAST_MM = 11;

// A link's QR code, as rows of dark (true) and light modules — worked out once a link (every copy of a part has the same).
const qrCache = new Map<string, boolean[][]>();
function qrModules(url: string): boolean[][] | null {
  const cached = qrCache.get(url);
  if (cached) return cached;
  try {
    // Medium error correction: still reads with a corner scuffed or a bit of glue over it.
    const code = qrcode(0, "M");
    code.addData(url);
    code.make();
    const count = code.getModuleCount();
    const rows = Array.from({ length: count }, (_, r) => Array.from({ length: count }, (_, c) => code.isDark(r, c)));
    qrCache.set(url, rows);
    return rows;
  } catch {
    return null;
  }
}

// The QR code at (x, y), size mm square: each row's run of dark modules one black rect (a hair taller, so rows meet
// without a hairline between them). The white round it is the label's own (its edges and the gap to the details).
function drawQr(ops: LabelOp[], rows: boolean[][], x: number, y: number, size: number) {
  const count = rows.length;
  if (!count) return;
  const cell = size / count;
  rows.forEach((row, r) => {
    let start = -1;
    for (let c = 0; c <= count; c += 1) {
      const dark = c < count && row[c];
      if (dark && start < 0) start = c;
      if (!dark && start >= 0) {
        ops.push({ kind: "rect", x: x + start * cell, y: y + r * cell, w: (c - start) * cell, h: cell + 0.02, fill: INK });
        start = -1;
      }
    }
  });
}

// A Custom piece's outline and its banded runs (mm, y down, its curves sampled), and how much of it is banded — null when
// it isn't a shape that can be drawn.
function labelShapeLines(shape: CutlistShape | null | undefined): { outline: ShapePoint[]; banded: ShapePoint[][]; bandedMm: number } | null {
  if (!shape) return null;
  try {
    const outline = shapeOutlinePolyline(shape);
    if (outline.length < 3) return null;
    return { outline, banded: shapeBandedPolylines(shape), bandedMm: shapeGeometry(shape).bandedLengthMm };
  } catch {
    return null;
  }
}

// The point `t` (0–1) of the way along a line, by its length.
function pointAlongLine(line: ShapePoint[], t: number): ShapePoint | null {
  if (line.length < 2) return null;
  const lengths = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i][0], p[1] - line[i][1]));
  const total = lengths.reduce((sum, l) => sum + l, 0);
  if (!(total > 0)) return line[0];
  let target = clamp(t, 0, 1) * total;
  for (let i = 0; i < lengths.length; i += 1) {
    if (target <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] > 0 ? Math.min(1, target / lengths[i]) : 0;
      return [line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f];
    }
    target -= lengths[i];
  }
  return null;
}

// Front on a door's drawing: this size on a 100 × 50 label. Smaller than the least and it won't read there.
const FRONT_MOST_PT = 6;
const FRONT_LEAST_PT = 4.5;
// A hinge's arrow: how far past its cup, and from the next arrow.
const ARROW_GAP_K = 0.8;
const ARROW_LANE_K = 1;

// The piece's outline, to scale, in the middle of its box: its clashed edges' Xs, its grain's arrow, a door's hinges
// (each with where it goes, beside its edge) — and its clashing and hinge side under it. A Custom piece: its real outline
// (its shape's), each banded run drawn heavier with an X across it, and how much is banded under it.
function drawOutline(ops: LabelOp[], label: PartLabel, box: { x: number; y: number; w: number; h: number }, k: number) {
  const markHalf = 1.15 * k;
  const hingeSize = 6.2 * k;
  const captionSize = 8.5 * k;
  const reserve = { top: markHalf, right: markHalf, bottom: markHalf, left: markHalf };
  const hinges = label.hinges;
  if (hinges) {
    if (hinges.side === "left" || hinges.side === "right") {
      reserve[hinges.side] += Math.max(0, ...hinges.marks.map((mark) => measureLabelText(mark.text, hingeSize))) + 1 * k;
    } else {
      reserve[hinges.side] += hingeSize * LABEL_PT * 0.75 + 1 * k;
    }
  }
  const shaped = labelShapeLines(label.shape);
  // A shape's sides' lengths: room for them all round it.
  const sideSize = 5.6 * k;
  const sideH = sideSize * LABEL_PT * 0.85;
  const sideTexts = shaped ? label.shapeSides ?? [] : [];
  if (sideTexts.length) {
    const widest = Math.max(0, ...sideTexts.map((text) => measureLabelText(text, sideSize)));
    reserve.left += widest + 0.6 * k;
    reserve.right += widest + 0.6 * k;
    reserve.top += sideH + 0.6 * k;
    reserve.bottom += sideH + 0.6 * k;
  }
  const clashCode = shaped ? (shaped.bandedMm > 0 ? `${formatShapeMetres(shaped.bandedMm)}m` : "") : label.clashCode;
  // (A door's hinges are drawn on its front, and drilled from the other side. Front's on the door, or if there's no room for it
  // there, beside its side under it.)
  const hasHingeMarks = Boolean(hinges && hinges.marks.length > 0);
  const caption = clashCode || hinges?.tag || hasHingeMarks ? captionSize * LABEL_PT * 1.35 : 0;
  const availW = box.w - reserve.left - reserve.right;
  const availH = box.h - reserve.top - reserve.bottom - caption;
  if (availW < 3 || availH < 3) return;
  const tall = Math.max(1, label.tallMm);
  const wide = Math.max(1, label.wideMm);
  const scale = Math.min(availW / wide, availH / tall);
  // A long thin piece still shows as something.
  const dw = clamp(wide * scale, Math.min(2.4 * k, availW), availW);
  const dh = clamp(tall * scale, Math.min(2.4 * k, availH), availH);
  const ox = box.x + reserve.left + (availW - dw) / 2;
  const oy = box.y + reserve.top + (availH - dh) / 2;
  // An X across an edge (or a run of one) at (cx, cy).
  const crossAt = (cx: number, cy: number) => {
    ops.push({ kind: "line", x1: cx - markHalf, y1: cy - markHalf, x2: cx + markHalf, y2: cy + markHalf, stroke: INK, lineWidth: 0.45 });
    ops.push({ kind: "line", x1: cx - markHalf, y1: cy + markHalf, x2: cx + markHalf, y2: cy - markHalf, stroke: INK, lineWidth: 0.45 });
  };
  if (shaped) {
    // Its shape's outline fitted onto the box the rectangle would be (the box round it is its Width × Height) — in
    // lines only (the on-screen label draws lines, not paths). Each banded run over it, heavier, with an X across its
    // middle (one going the whole way round: two, opposite each other).
    const xs = shaped.outline.map((p) => p[0]);
    const ys = shaped.outline.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const spanX = Math.max(Math.max(...xs) - minX, 1e-6);
    const spanY = Math.max(Math.max(...ys) - minY, 1e-6);
    const at = (p: ShapePoint): ShapePoint => [ox + ((p[0] - minX) / spanX) * dw, oy + ((p[1] - minY) / spanY) * dh];
    const outline = shaped.outline.map(at);
    outline.forEach((p, index) => {
      const q = outline[(index + 1) % outline.length];
      ops.push({ kind: "line", x1: p[0], y1: p[1], x2: q[0], y2: q[1], stroke: INK, lineWidth: 0.4 });
    });
    for (const run of shaped.banded) {
      const line = run.map(at);
      for (let index = 0; index < line.length - 1; index += 1) {
        ops.push({ kind: "line", x1: line[index][0], y1: line[index][1], x2: line[index + 1][0], y2: line[index + 1][1], stroke: INK, lineWidth: 0.9 });
      }
      const first = line[0];
      const last = line[line.length - 1];
      const closed = line.length > 2 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6;
      for (const t of closed ? [0.25, 0.75] : [0.5]) {
        const mark = pointAlongLine(line, t);
        if (mark) crossAt(mark[0], mark[1]);
      }
    }
    // Each side's length, just outside its middle (a curve's: the middle of its curve), clear of the others and in the drawing's box:
    // one that's had to move has a fine line back to its side.
    if (sideTexts.length && label.shape) {
      const clearOfEdge = markHalf + 0.3 * k;
      const room = { width: box.w, height: box.h - caption };
      const requests = shapeGeometry(label.shape).edges.flatMap((edge) => {
        const text = sideTexts[edge.index];
        if (!text || edge.vertexLength < 1e-6) return [];
        const curve = edge.curve ? segmentArcPoints(edge.curve) : [];
        const middle: ShapePoint = curve.length
          ? curve[Math.floor(curve.length / 2)]
          : [(edge.startVertex[0] + edge.endVertex[0]) / 2, (edge.startVertex[1] + edge.endVertex[1]) / 2];
        const anchor = at(middle);
        const width = measureLabelText(text, sideSize);
        const out = clearOfEdge + (Math.abs(edge.normal[0]) * width + Math.abs(edge.normal[1]) * sideH) / 2;
        return [
          {
            id: String(edge.index),
            text,
            width,
            height: sideH,
            x: anchor[0] - box.x + edge.normal[0] * out,
            y: anchor[1] - box.y + edge.normal[1] * out,
            anchor: [anchor[0] - box.x, anchor[1] - box.y] as ShapePoint,
            normal: edge.normal,
          },
        ];
      });
      for (const side of placeShapeLabels(requests, room, { gap: 0.3 * k, step: 0.7 * k, reach: 14, margin: 0 })) {
        const cx = side.cx + box.x;
        const cy = side.cy + box.y;
        if (side.moved) {
          const fromX = clamp(side.anchor[0] + box.x, cx - side.width / 2, cx + side.width / 2);
          const fromY = clamp(side.anchor[1] + box.y, cy - sideH / 2, cy + sideH / 2);
          if (Math.hypot(fromX - (side.anchor[0] + box.x), fromY - (side.anchor[1] + box.y)) > clearOfEdge + 0.4 * k) {
            ops.push({ kind: "line", x1: fromX, y1: fromY, x2: side.anchor[0] + box.x, y2: side.anchor[1] + box.y, stroke: SOFT, lineWidth: 0.15 });
          }
        }
        ops.push({ kind: "text", x: cx, y: cy + sideH * 0.42, text: side.text, size: sideSize, color: INK, align: "center" });
      }
    }
  } else {
    ops.push({ kind: "rect", x: ox, y: oy, w: dw, h: dh, stroke: INK, lineWidth: 0.4 });
  }

  // Its grain: an arrow down its middle, the way it runs.
  if (label.grain === "tall" ? dh > 7 && dw > 3 : label.grain === "wide" ? dw > 7 && dh > 3 : false) {
    const along = label.grain === "tall";
    const length = (along ? dh : dw) * 0.56;
    const head = Math.min(1.4 * k, length * 0.18);
    const cx = ox + dw / 2;
    const cy = oy + dh / 2;
    if (along) {
      ops.push({ kind: "line", x1: cx, y1: cy - length / 2, x2: cx, y2: cy + length / 2, stroke: SOFT, lineWidth: 0.25 });
      for (const end of [-1, 1]) {
        const tipY = cy + (end * length) / 2;
        ops.push({ kind: "line", x1: cx, y1: tipY, x2: cx - head * 0.7, y2: tipY - end * head, stroke: SOFT, lineWidth: 0.25 });
        ops.push({ kind: "line", x1: cx, y1: tipY, x2: cx + head * 0.7, y2: tipY - end * head, stroke: SOFT, lineWidth: 0.25 });
      }
    } else {
      ops.push({ kind: "line", x1: cx - length / 2, y1: cy, x2: cx + length / 2, y2: cy, stroke: SOFT, lineWidth: 0.25 });
      for (const end of [-1, 1]) {
        const tipX = cx + (end * length) / 2;
        ops.push({ kind: "line", x1: tipX, y1: cy, x2: tipX - end * head, y2: cy - head * 0.7, stroke: SOFT, lineWidth: 0.25 });
        ops.push({ kind: "line", x1: tipX, y1: cy, x2: tipX - end * head, y2: cy + head * 0.7, stroke: SOFT, lineWidth: 0.25 });
      }
    }
  }

  // An X on each edge that's clashed, across its middle.
  for (const edge of shaped ? [] : label.clashed) {
    const cx = edge === "left" ? ox : edge === "right" ? ox + dw : ox + dw / 2;
    const cy = edge === "top" ? oy : edge === "bottom" ? oy + dh : oy + dh / 2;
    crossAt(cx, cy);
  }

  let frontOnDoor = false;
  // A door's hinges, to scale: each a 35 mm cup, its centre 22.5 mm in from the hinged edge and exactly as far along it
  // as the cutlist says (never smaller than a dot). Its distance is beside it outside the edge, a fine line from there
  // to the cup's centre.
  if (hinges) {
    const vertical = hinges.side === "left" || hinges.side === "right";
    const span = vertical ? dh : dw;
    const across = vertical ? dw : dh;
    const perMm = span / (vertical ? tall : wide);
    const acrossPerMm = across / (vertical ? wide : tall);
    const r = Math.max(0.4, 17.5 * perMm);
    const inset = Math.min(Math.max(r + 0.15, 22.5 * acrossPerMm), across / 2);
    for (const mark of hinges.marks) {
      const along = clamp(mark.from === "start" ? mark.at * perMm : span - mark.at * perMm, 0, span);
      const cx = vertical ? (hinges.side === "left" ? ox + inset : ox + dw - inset) : ox + along;
      const cy = vertical ? oy + along : hinges.side === "top" ? oy + inset : oy + dh - inset;
      ops.push({ kind: "circle", cx, cy, r, stroke: INK, lineWidth: 0.3 });
      const textY = cy + hingeSize * LABEL_PT * 0.35;
      const leader = markHalf * 0.85;
      if (hinges.side === "left") {
        ops.push({ kind: "line", x1: ox - leader, y1: cy, x2: cx - r, y2: cy, stroke: SOFT, lineWidth: 0.2 });
        ops.push({ kind: "text", x: ox - markHalf - 0.4 * k, y: textY, text: mark.text, size: hingeSize, color: INK, align: "right" });
      } else if (hinges.side === "right") {
        ops.push({ kind: "line", x1: cx + r, y1: cy, x2: ox + dw + leader, y2: cy, stroke: SOFT, lineWidth: 0.2 });
        ops.push({ kind: "text", x: ox + dw + markHalf + 0.4 * k, y: textY, text: mark.text, size: hingeSize, color: INK });
      } else if (hinges.side === "top") {
        ops.push({ kind: "line", x1: cx, y1: oy - leader, x2: cx, y2: cy - r, stroke: SOFT, lineWidth: 0.2 });
        ops.push({ kind: "text", x: cx, y: oy - markHalf - 0.4 * k, text: mark.text, size: hingeSize, color: INK, align: "center" });
      } else {
        ops.push({ kind: "line", x1: cx, y1: cy + r, x2: cx, y2: oy + dh + leader, stroke: SOFT, lineWidth: 0.2 });
        ops.push({ kind: "text", x: cx, y: oy + dh + markHalf + 0.4 * k + hingeSize * LABEL_PT * 0.72, text: mark.text, size: hingeSize, color: INK, align: "center" });
      }
    }
    // An arrow on the door from each hinge to the end it's measured from: just past the cups, the shortest nearest them so one's line
    // across to its arrow doesn't cross another's. Ones that don't overlap share a line (a pair's, one from each end).
    const inward = hinges.side === "left" || hinges.side === "top" ? 1 : -1;
    const alongOf = (mark: LabelHingeMark) => clamp(mark.from === "start" ? mark.at * perMm : span - mark.at * perMm, 0, span);
    const reachOf = (mark: LabelHingeMark) => (mark.from === "start" ? alongOf(mark) : span - alongOf(mark));
    const laneRuns: Array<Array<[number, number]>> = [];
    const arrows = [...hinges.marks].sort((a, b) => reachOf(a) - reachOf(b)).map((mark) => {
      const along = alongOf(mark);
      const run: [number, number] = mark.from === "start" ? [0, along] : [along, span];
      let lane = laneRuns.findIndex((runs) => runs.every(([from, to]) => run[1] < from || run[0] > to));
      if (lane < 0) lane = laneRuns.push([]) - 1;
      laneRuns[lane].push(run);
      return { mark, lane };
    });
    arrows.forEach(({ mark, lane }) => {
      const along = alongOf(mark);
      const away = inset + r + ARROW_GAP_K * k + lane * ARROW_LANE_K * k;
      const end = mark.from === "start" ? 0 : span;
      const reach = Math.abs(end - along);
      const head = Math.min(0.9 * k, reach * 0.4);
      const tip = end === 0 ? 1 : -1;
      if (vertical) {
        const edgeX = hinges.side === "left" ? ox : ox + dw;
        const cupX = edgeX + inward * (inset + r);
        const x = clamp(edgeX + inward * away, ox + 0.3, ox + dw - 0.3);
        ops.push({ kind: "line", x1: cupX, y1: oy + along, x2: x, y2: oy + along, stroke: INK, lineWidth: 0.2 });
        ops.push({ kind: "line", x1: x, y1: oy + along, x2: x, y2: oy + end, stroke: INK, lineWidth: 0.2 });
        for (const wing of [-1, 1]) ops.push({ kind: "line", x1: x, y1: oy + end, x2: x + wing * head * 0.6, y2: oy + end + tip * head, stroke: INK, lineWidth: 0.2 });
      } else {
        const edgeY = hinges.side === "top" ? oy : oy + dh;
        const cupY = edgeY + inward * (inset + r);
        const y = clamp(edgeY + inward * away, oy + 0.3, oy + dh - 0.3);
        ops.push({ kind: "line", x1: ox + along, y1: cupY, x2: ox + along, y2: y, stroke: INK, lineWidth: 0.2 });
        ops.push({ kind: "line", x1: ox + along, y1: y, x2: ox + end, y2: y, stroke: INK, lineWidth: 0.2 });
        for (const wing of [-1, 1]) ops.push({ kind: "line", x1: ox + end, y1: y, x2: ox + end + tip * head, y2: y + wing * head * 0.6, stroke: INK, lineWidth: 0.2 });
      }
    });

    // Front, in the middle of the door, clear of its hinges and their arrows either side, on white so it reads over the grain's arrow.
    if (hasHingeMarks) {
      const clear = inset + r + (laneRuns.length ? ARROW_GAP_K * k + laneRuns.length * ARROW_LANE_K * k : 0);
      const spaceW = vertical ? dw - 2 * clear : dw;
      const spaceH = vertical ? dh : dh - 2 * clear;
      const frontMost = FRONT_MOST_PT * k;
      const frontSize = Math.min(frontMost, (spaceW * 0.92 * frontMost) / Math.max(0.01, measureLabelText("Front", frontMost, true)), (spaceH * 0.92) / (LABEL_PT * 1.1));
      if (frontSize >= FRONT_LEAST_PT) {
        const midX = ox + dw / 2;
        const midY = oy + dh / 2;
        const frontW = measureLabelText("Front", frontSize, true);
        const frontH = frontSize * LABEL_PT;
        ops.push({ kind: "rect", x: midX - frontW / 2 - 0.5 * k, y: midY - frontH * 0.62, w: frontW + 1 * k, h: frontH * 1.24, fill: "#FFFFFF" });
        ops.push({ kind: "text", x: midX, y: midY + frontH * 0.36, text: "Front", size: frontSize, bold: true, color: INK, align: "center" });
        frontOnDoor = true;
      }
    }
  }

  // Under it: its clashing (bold), then its hinges' side (and Front, if it couldn't go on the door).
  if (caption) {
    const base = oy + dh + reserve.bottom + captionSize * LABEL_PT * 1.05;
    const tagWords = [hinges?.tag, hasHingeMarks && !frontOnDoor ? "Front" : ""].filter(Boolean).join(" · ");
    const tag = tagWords ? `${clashCode ? "  ·  " : ""}${tagWords}` : "";
    // (Too wide for its box, smaller: it can't run off the label.)
    const naturalW = measureLabelText(clashCode, captionSize, true) + measureLabelText(tag, captionSize);
    const fittedSize = naturalW > box.w ? (captionSize * box.w) / naturalW : captionSize;
    const codeW = measureLabelText(clashCode, fittedSize, true);
    const tagW = measureLabelText(tag, fittedSize);
    const startX = clamp(ox + dw / 2 - (codeW + tagW) / 2, box.x, box.x + box.w - codeW - tagW);
    if (clashCode) ops.push({ kind: "text", x: startX, y: base, text: clashCode, size: fittedSize, bold: true, color: INK });
    if (tag) ops.push({ kind: "text", x: startX + codeW, y: base, text: tag, size: fittedSize, color: SOFT });
  }
}

// Its size (each number with which it is over it), board and information lines.
function drawDetails(
  ops: LabelOp[],
  label: PartLabel,
  box: { x: number; y: number; w: number; bottom: number },
  k: number,
  valueSizeMax: number,
  addText: (text: string, x: number, y: number, sizePt: number, options?: { bold?: boolean; color?: string; align?: "left" | "center" | "right" }) => void,
  // The QR code's top left, in the corner: only a line level with it has less room.
  qrCorner: { left: number; top: number } | null = null,
) {
  if (box.w <= 4) return;
  // The width a line with its baseline at `base` can have (its descenders counted, in `sizePt`).
  const widthAt = (base: number, sizePt: number) =>
    qrCorner && base + sizePt * LABEL_PT * 0.28 + 0.8 * k > qrCorner.top ? qrCorner.left - 2.5 * k - box.x : box.w;
  let y = box.y;
  const sizes = label.sizes.filter((part) => part.value);
  if (sizes.length) {
    const captionSize = 5.6 * k;
    const separator = " × ";
    const sizesWidth = (sizePt: number) =>
      sizes.reduce((sum, part, index) => sum + measureLabelText(part.value, sizePt, true) + (index ? measureLabelText(separator, sizePt, true) : 0), 0);
    let valueSize = valueSizeMax;
    const natural = sizesWidth(valueSize);
    const captionBase = y + captionSize * LABEL_PT * 0.75;
    const sizesRoom = widthAt(captionBase + 0.8 * k + valueSize * LABEL_PT * 0.74, valueSize);
    if (natural > sizesRoom) valueSize *= sizesRoom / natural;
    const valueBase = captionBase + 0.8 * k + valueSize * LABEL_PT * 0.74;
    let x = box.x;
    sizes.forEach((part, index) => {
      if (index) {
        addText(separator, x, valueBase, valueSize, { bold: true, color: SOFT });
        x += measureLabelText(separator, valueSize, true);
      }
      const valueW = measureLabelText(part.value, valueSize, true);
      addText(part.axis, x + valueW / 2, captionBase, captionSize, { bold: true, color: SOFT, align: "center" });
      addText(part.value, x, valueBase, valueSize, { bold: true });
      x += valueW;
    });
    y = valueBase + 2.6 * k;
  }
  // Its board: over two lines if it needs them, three if it's going round the QR code.
  if (label.board) {
    const boardSize = 7.2 * k;
    const boardBase = (index: number) => y + boardSize * LABEL_PT * (0.74 + index * 1.15);
    let base = y;
    for (const [index, line] of wrapText(label.board, (index) => widthAt(boardBase(index), boardSize), boardSize, true, qrCorner ? 3 : 2).entries()) {
      const next = boardBase(index);
      if (next > box.bottom) break;
      addText(line, box.x, next, boardSize, { bold: true });
      base = next;
    }
    if (base === y) return;
    y = base + 1.8 * k;
  }
  const infoSize = 6.4 * k;
  const lineH = infoSize * LABEL_PT * 1.28;
  const lineBase = (index: number) => y + lineH * index + infoSize * LABEL_PT * 0.74;
  const lines: string[] = [];
  for (const info of label.info) {
    const startAt = lines.length;
    lines.push(...wrapText(info, (index) => widthAt(lineBase(startAt + index), infoSize), infoSize));
  }
  const room = Math.floor((box.bottom - y) / lineH);
  if (room <= 0 || !lines.length) return;
  const shown = lines.length > room ? [...lines.slice(0, Math.max(0, room - 1)), `+${lines.length - room + 1} more`] : lines;
  shown.forEach((line, index) => {
    addText(line, box.x, lineBase(index), infoSize, { color: index === shown.length - 1 && lines.length > room ? SOFT : INK });
  });
}

type JsPdfCtor = typeof import("jspdf").jsPDF;

// The labels to print: one a page, each page the label's size — so a label printer prints one label for each. Or filling A4 sheets,
// a faint line round each to cut along.
export function buildPartLabelsPdf(
  jsPDF: JsPdfCtor,
  labels: PartLabel[],
  size: LabelSize,
  logo: PrintTitleLogo | null,
  layout: LabelPrintLayout = "roll",
): Blob | null {
  if (!labels.length) return null;
  if (layout === "a4") {
    const sheet = labelSheetLayout(size);
    const doc = new jsPDF({ orientation: sheet.orientation, unit: "mm", format: "a4", compress: true });
    doc.setLineCap("round");
    labels.forEach((label, index) => {
      const place = index % sheet.perSheet;
      if (index > 0 && place === 0) doc.addPage("a4", sheet.orientation);
      const x = sheet.left + (place % sheet.columns) * size.width;
      const y = sheet.top + Math.floor(place / sheet.columns) * size.height;
      drawLabelOp(doc, { kind: "rect", x, y, w: size.width, h: size.height, stroke: CUT_LINE, lineWidth: 0.1 }, logo);
      for (const op of layoutPartLabel(label, size, logo)) drawLabelOp(doc, movedLabelOp(op, x, y), logo);
    });
    return doc.output("blob");
  }
  const orientation = size.width > size.height ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation, unit: "mm", format: [size.width, size.height], compress: true });
  doc.setLineCap("round");
  labels.forEach((label, index) => {
    if (index > 0) doc.addPage([size.width, size.height], orientation);
    for (const op of layoutPartLabel(label, size, logo)) drawLabelOp(doc, op, logo);
  });
  return doc.output("blob");
}

const CUT_LINE = "#BDBDBD";

// A little off a label each way when it's printed to fit the paper. Exactly the paper's size, rounding can tip it onto a page of its own.
const FIT_TRIM_MM = 0.3;
// Paper this much wider than a label is a sheet of them, not a label printer's roll.
const SHEET_WIDER_BY_MM = 30;

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function labelOpsSvg(ops: LabelOp[], size: LabelSize, logo: PrintTitleLogo | null): string {
  const shapes = ops.map((op) => {
    if (op.kind === "rect") {
      return `<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" rx="${op.radius ?? 0}" fill="${op.fill ?? "none"}" stroke="${op.stroke ?? "none"}" stroke-width="${op.lineWidth ?? 0.3}"/>`;
    }
    if (op.kind === "line") return `<line x1="${op.x1}" y1="${op.y1}" x2="${op.x2}" y2="${op.y2}" stroke="${op.stroke}" stroke-width="${op.lineWidth}" stroke-linecap="round"/>`;
    if (op.kind === "circle") return `<circle cx="${op.cx}" cy="${op.cy}" r="${op.r}" fill="none" stroke="${op.stroke}" stroke-width="${op.lineWidth}"/>`;
    if (op.kind === "text") {
      const anchor = op.align === "center" ? "middle" : op.align === "right" ? "end" : "start";
      return `<text x="${op.x}" y="${op.y}" font-size="${op.size * LABEL_PT}" font-weight="${op.bold ? 700 : 400}" fill="${op.color}" text-anchor="${anchor}" xml:space="preserve">${escapeXml(op.text)}</text>`;
    }
    return logo ? `<image href="${logo.dataUrl}" x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" preserveAspectRatio="xMidYMid meet"/>` : "";
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="xMidYMid meet">${shapes.join("")}</svg>`;
}

// The labels as a page for the browser to print, its layout left to the paper picked in the print window: each label its real size,
// flowing across and down, so a label printer's page takes one and an A4 sheet as many as fit (the browser lays it out again as the
// paper's changed there). Paper smaller than a label: the label shrunk to fit it. On a sheet, a margin for what an ordinary printer
// can't reach and a faint line to cut along.
export function partLabelsPrintHtml(labels: PartLabel[], size: LabelSize, logo: PrintTitleLogo | null): string {
  const cells = labels.map((label) => `<div class="label">${labelOpsSvg(layoutPartLabel(label, size, logo), size, logo)}</div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
@page { margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Arial, Helvetica, sans-serif; text-align: center; line-height: 0; font-size: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.label { display: inline-block; vertical-align: top; box-sizing: border-box; width: ${size.width - FIT_TRIM_MM}mm; height: ${size.height - FIT_TRIM_MM}mm; max-width: 100vw; max-height: calc(100vh - ${FIT_TRIM_MM}mm); overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
.label svg { display: block; width: 100%; height: 100%; }
@media (min-width: ${size.width + SHEET_WIDER_BY_MM}mm) {
  @page { margin: ${SHEET_MARGIN_MM}mm; }
  .label { outline: 0.1mm solid ${CUT_LINE}; outline-offset: -0.05mm; }
}
</style></head><body>${cells}</body></html>`;
}

// A label's shape or text, for a label whose top left is at (dx, dy) on the page.
function movedLabelOp(op: LabelOp, dx: number, dy: number): LabelOp {
  if (op.kind === "line") return { ...op, x1: op.x1 + dx, y1: op.y1 + dy, x2: op.x2 + dx, y2: op.y2 + dy };
  if (op.kind === "circle") return { ...op, cx: op.cx + dx, cy: op.cy + dy };
  return { ...op, x: op.x + dx, y: op.y + dy };
}

function drawLabelOp(doc: JsPdf, op: LabelOp, logo: PrintTitleLogo | null) {
  if (op.kind === "rect") {
    doc.setLineWidth(op.lineWidth ?? 0.3);
    if (op.fill) doc.setFillColor(op.fill);
    if (op.stroke) doc.setDrawColor(op.stroke);
    const style = op.fill && op.stroke ? "FD" : op.fill ? "F" : "S";
    if (op.radius) doc.roundedRect(op.x, op.y, op.w, op.h, op.radius, op.radius, style);
    else doc.rect(op.x, op.y, op.w, op.h, style);
  } else if (op.kind === "line") {
    doc.setDrawColor(op.stroke);
    doc.setLineWidth(op.lineWidth);
    doc.line(op.x1, op.y1, op.x2, op.y2);
  } else if (op.kind === "circle") {
    doc.setDrawColor(op.stroke);
    doc.setLineWidth(op.lineWidth);
    doc.circle(op.cx, op.cy, op.r, "S");
  } else if (op.kind === "text") {
    doc.setFont("helvetica", op.bold ? "bold" : "normal");
    doc.setFontSize(op.size);
    doc.setTextColor(op.color);
    doc.text(op.text, op.x, op.y, { align: op.align ?? "left", baseline: "alphabetic" });
  } else if (op.kind === "logo" && logo) {
    doc.addImage(logo.dataUrl, logo.format, op.x, op.y, op.w, op.h);
  }
}
