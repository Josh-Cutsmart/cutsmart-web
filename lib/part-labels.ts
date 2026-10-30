"use client";

import type { jsPDF as JsPdf } from "jspdf";
import qrcode from "qrcode-generator";
import { formatShapeMetres, shapeGeometry, type CutlistShape, type ShapePoint } from "@/lib/cutlist-shape";
import { shapeBandedPolylines, shapeOutlinePolyline } from "@/lib/cutlist-shape-render";
import type { PrintTitleLogo } from "@/lib/print-title-page";

// Production › Labels: a sticky label for every piece the workshop cuts — one per piece (a part's quantity is that
// many labels; a cabinet's, drawer's or door's own pieces each have theirs, under its ID). Each label has:
//  - the part's ID (as the CNC Cutlist and the Nesting sheets number it) in a black tile, its name, and what it's part
//    of / its room / its part type; the company's logo top right;
//  - the piece's outline, to scale, with an X on each edge that's clashed and its clashing (1L1S) under it — a door's
//    hinges drawn on it too, each with where it goes;
//  - its size, each number with which it is (H, W, D) over it; its board; its information lines;
//  - along the bottom: the project and who it's for, and which of its copies it is (2 of 4);
//  - with qrUrl: a QR code in the bottom right of its body — scanned with a phone's camera, it opens the part in its
//    project (Production › Labels' "QR codes").
// Laid out once (layoutPartLabel: plain shapes and text, in mm, from the label's top left) and drawn from that both on
// screen (components/part-label.tsx) and into the PDF that prints them (one label a page, the page the label's size),
// so the two are always the same. Black and grey only: label printers are mostly thermal, black on white.

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

export function labelSizeById(id: string | null | undefined): LabelSize {
  return LABEL_SIZES.find((size) => size.id === id) ?? LABEL_SIZES.find((size) => size.id === DEFAULT_LABEL_SIZE_ID) ?? LABEL_SIZES[0];
}

export type LabelEdge = "top" | "right" | "bottom" | "left";

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
  // (its top, or its left on a top-hinged door) or its end, and that distance as written.
  hinges: { side: LabelEdge; tag: string; marks: Array<{ at: number; from: "start" | "end"; text: string }> } | null;
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
};

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
function wrapText(text: string, maxWidth: number, sizePt: number, bold = false, maxLines = Infinity): string[] {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measureLabelText(next, sizePt, bold) <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fitText(lines.slice(maxLines - 1).join(" "), maxWidth, sizePt, bold);
    return kept;
  }
  return lines.map((each) => fitText(each, maxWidth, sizePt, bold));
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
  // (if it has one) in the bottom right corner, the details beside it narrowed to leave it room.
  const bodyTop = divider + 2 * k;
  const bodyBottom = footRule - 2 * k;
  const qr = label.qrUrl ? qrModules(label.qrUrl) : null;
  if (portrait) {
    const diagramH = (bodyBottom - bodyTop) * 0.42;
    drawOutline(ops, label, { x: m, y: bodyTop, w: W - 2 * m, h: diagramH }, k);
    const detailsY = bodyTop + diagramH + 2.5 * k;
    const qrSize = qr ? clamp(Math.min(bodyBottom - detailsY, (W - 2 * m) * 0.36), 0, 26) : 0;
    const qrShown = qr && qrSize >= 11;
    if (qrShown) drawQr(ops, qr, W - m - qrSize, bodyBottom - qrSize, qrSize);
    drawDetails(ops, label, { x: m, y: detailsY, w: W - 2 * m - (qrShown ? qrSize + 2.5 * k : 0), bottom: bodyBottom }, k, 17 * k, addText);
  } else {
    const diagramW = (W - 2 * m) * 0.4;
    drawOutline(ops, label, { x: m, y: bodyTop, w: diagramW, h: bodyBottom - bodyTop }, k);
    const detailsX = m + diagramW + 3.5 * k;
    const qrSize = qr ? clamp(Math.min(bodyBottom - bodyTop, (W - m - detailsX) * 0.42), 0, 24) : 0;
    const qrShown = qr && qrSize >= 11;
    if (qrShown) drawQr(ops, qr, W - m - qrSize, bodyBottom - qrSize, qrSize);
    drawDetails(ops, label, { x: detailsX, y: bodyTop, w: W - m - detailsX - (qrShown ? qrSize + 2.5 * k : 0), bottom: bodyBottom }, k, 16 * k, addText);
  }
  return ops;
}

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
  const clashCode = shaped ? (shaped.bandedMm > 0 ? `Banded ${formatShapeMetres(shaped.bandedMm)} m` : "") : label.clashCode;
  const caption = clashCode || hinges?.tag ? captionSize * LABEL_PT * 1.35 : 0;
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
  }

  // Under it: its clashing (bold), then its hinges' side.
  if (caption) {
    const base = oy + dh + reserve.bottom + captionSize * LABEL_PT * 1.05;
    const tag = hinges?.tag ? `${clashCode ? "  ·  " : ""}${hinges.tag}` : "";
    const codeW = measureLabelText(clashCode, captionSize, true);
    const tagW = measureLabelText(tag, captionSize);
    const startX = clamp(ox + dw / 2 - (codeW + tagW) / 2, box.x, box.x + box.w - codeW - tagW);
    if (clashCode) ops.push({ kind: "text", x: startX, y: base, text: clashCode, size: captionSize, bold: true, color: INK });
    if (tag) ops.push({ kind: "text", x: startX + codeW, y: base, text: tag, size: captionSize, color: SOFT });
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
) {
  if (box.w <= 4) return;
  let y = box.y;
  const sizes = label.sizes.filter((part) => part.value);
  if (sizes.length) {
    const captionSize = 6.5 * k;
    const separator = " × ";
    const widthAt = (sizePt: number) =>
      sizes.reduce((sum, part, index) => sum + measureLabelText(part.value, sizePt, true) + (index ? measureLabelText(separator, sizePt, true) : 0), 0);
    let valueSize = valueSizeMax;
    const natural = widthAt(valueSize);
    if (natural > box.w) valueSize *= box.w / natural;
    const captionBase = y + captionSize * LABEL_PT * 0.75;
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
  // Its board: over two lines if it needs them.
  if (label.board) {
    const boardSize = 8.6 * k;
    let base = y;
    for (const [index, line] of wrapText(label.board, box.w, boardSize, true, 2).entries()) {
      const next = y + boardSize * LABEL_PT * (0.74 + index * 1.15);
      if (next > box.bottom) break;
      addText(line, box.x, next, boardSize, { bold: true });
      base = next;
    }
    if (base === y) return;
    y = base + 1.8 * k;
  }
  const infoSize = 7.6 * k;
  const lineH = infoSize * LABEL_PT * 1.28;
  const lines = label.info.flatMap((line) => wrapText(line, box.w, infoSize));
  const room = Math.floor((box.bottom - y) / lineH);
  if (room <= 0 || !lines.length) return;
  const shown = lines.length > room ? [...lines.slice(0, Math.max(0, room - 1)), `+${lines.length - room + 1} more`] : lines;
  shown.forEach((line, index) => {
    addText(line, box.x, y + lineH * index + infoSize * LABEL_PT * 0.74, infoSize, { color: index === shown.length - 1 && lines.length > room ? SOFT : INK });
  });
}

type JsPdfCtor = typeof import("jspdf").jsPDF;

// The labels to print: one a page, each page the label's size — so a label printer prints one label for each.
export function buildPartLabelsPdf(jsPDF: JsPdfCtor, labels: PartLabel[], size: LabelSize, logo: PrintTitleLogo | null): Blob | null {
  if (!labels.length) return null;
  const orientation = size.width > size.height ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation, unit: "mm", format: [size.width, size.height], compress: true });
  doc.setLineCap("round");
  labels.forEach((label, index) => {
    if (index > 0) doc.addPage([size.width, size.height], orientation);
    for (const op of layoutPartLabel(label, size, logo)) drawLabelOp(doc, op, logo);
  });
  return doc.output("blob");
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
