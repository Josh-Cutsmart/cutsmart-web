// A cutlist shape (lib/cutlist-shape.ts) drawn for the screens and papers other than its editor — the CNC cutlist,
// nesting, prints, labels, the PDF and Excel. Pure, no React; only shapeDrawingPngDataUrl needs a browser (a canvas).
//
//  - shapeOutlinePolyline / shapeBandedPolylines: the outline and its banding as points (mm, y down), its curves
//    sampled finely enough to print — for drawing it any way at all (jsPDF lines, a canvas, nesting's own SVG).
//  - shapeDrawingOps: the whole drawing — outline, banding, arrows at the banding, dimensions (a custom outline's
//    cut-outs placed too), angles, R and curve labels — as
//    a list of plain drawing steps (paths, boxes, text) in px, so anything can draw it the same (jsPDF included).
//  - shapeDrawingSvg: that drawing as a standalone SVG (inline attributes only — no CSS variables: it goes on white
//    paper). shapeDrawingPngDataUrl: the same as a PNG, for Excel and PDF images.

import {
  formatShapeDegrees,
  formatShapeMm,
  placeShapeLabels,
  sampleShapeOutline,
  shapeBandedChains,
  shapeChainPoints,
  shapeCornerAngles,
  shapeCutoutDimensions,
  shapeGeometry,
  templateDimensions,
  isTemplateShapeKind,
  type CutlistShape,
  type ShapeDimension,
  type ShapeGeometry,
  type ShapeLabelBox,
  type ShapeLabelRequest,
  type ShapePoint,
  type ShapeSampleOptions,
} from "@/lib/cutlist-shape";

// The colour edge banding is drawn in (as components/cutlist-shape-thumbnail.tsx's CUTLIST_SHAPE_BAND_COLOR).
export const SHAPE_PRINT_BAND_COLOR = "#D97706";
// Ink and the softer grey of the prints (lib/part-labels.ts, the cabinet drawings).
const INK = "#0F172A";
const SOFT = "#64748B";
const FONT_FAMILY = "Helvetica, Arial, sans-serif";

// Fine enough to print: no straight piece more than 0.05 mm off its curve, none turning more than 2°.
const PRINT_SAMPLING: ShapeSampleOptions = { stepRadians: Math.PI / 90, toleranceMm: 0.05 };

const sub = (a: ShapePoint, b: ShapePoint): ShapePoint => [a[0] - b[0], a[1] - b[1]];
const add = (a: ShapePoint, b: ShapePoint): ShapePoint => [a[0] + b[0], a[1] + b[1]];
const mul = (a: ShapePoint, k: number): ShapePoint => [a[0] * k, a[1] * k];
const dot = (a: ShapePoint, b: ShapePoint) => a[0] * b[0] + a[1] * b[1];
const len = (a: ShapePoint) => Math.hypot(a[0], a[1]);
const unit = (a: ShapePoint): ShapePoint => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
};
const mid = (a: ShapePoint, b: ShapePoint): ShapePoint => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const round2 = (value: number) => Math.round(value * 100) / 100;

// Consecutive points closer than this (mm) are one.
function dedupe(points: ShapePoint[], closed: boolean): ShapePoint[] {
  const out: ShapePoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push([p[0], p[1]]);
  }
  if (closed && out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-6) out.pop();
  return out;
}

// ---- As points.

// The closed outline (mm, y down), its rounded corners and curves sampled to print. The last point joins back to the
// first (it isn't repeated). Empty if it isn't a shape that can be cut.
export function shapeOutlinePolyline(shape: CutlistShape): ShapePoint[] {
  const geometry = shapeGeometry(shape);
  if (!geometry.valid) return [];
  return dedupe(
    sampleShapeOutline(geometry, PRINT_SAMPLING).map((sample) => sample.point),
    true,
  );
}

// Each stretch of banding (mm): banded edges joined through their rounded or smooth corners, as one line each. One
// that goes the whole way round ends back on its first point.
export function shapeBandedPolylines(shape: CutlistShape): ShapePoint[][] {
  const geometry = shapeGeometry(shape);
  return bandedPolylinesFor(geometry);
}
function bandedPolylinesFor(geometry: ShapeGeometry): ShapePoint[][] {
  if (!geometry.valid) return [];
  return shapeBandedChains(geometry)
    .map((chain) => shapeChainPoints(geometry, chain, PRINT_SAMPLING))
    .filter((line) => line.length >= 2);
}

// ---- The drawing, as steps.

export type ShapeDrawingOptions = {
  // Its size (px): the shape fitted inside it and centred, room left round it for its numbers. Default 360 × 240.
  width?: number;
  height?: number;
  // Its dimension lines and numbers (sizes, segment lengths, R labels, curve heights). Default on.
  showDimensions?: boolean;
  // An arrow pointing at each banded stretch. Default on.
  showBandingArrows?: boolean;
  // Its wash (default a pale blue-grey, #E9EFF8) and how strong (default 1); its outline's colour (default #334155).
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  // Its numbers' size (px, default 10) — the lines, arrows and gaps scale with it.
  fontSize?: number;
  // Behind it all (default nothing: transparent).
  background?: string;
  // The banding's colour (default #D97706).
  bandColor?: string;
};

// One step of a drawing (px, y down). A path's points in order (closed: back to its first); a box (r: its corners'
// radius); text with its baseline at y, lined up on x by `align`.
export type ShapeDrawingOp =
  | {
      kind: "path";
      points: ShapePoint[];
      closed: boolean;
      fill?: string;
      fillOpacity?: number;
      stroke?: string;
      lineWidth?: number;
      lineCap?: "butt" | "round";
      lineJoin?: "miter" | "round";
    }
  | { kind: "rect"; x: number; y: number; w: number; h: number; r: number; fill: string; stroke?: string; lineWidth?: number }
  | { kind: "text"; x: number; y: number; text: string; size: number; color: string; align: "left" | "center" | "right"; bold?: boolean };

export type ShapeDrawingLabel = { id: string; text: string; box: ShapeLabelBox; moved: boolean };
export type ShapeDrawing = {
  width: number;
  height: number;
  // px per mm, and mm to px.
  scale: number;
  toPx: (p: ShapePoint) => ShapePoint;
  ops: ShapeDrawingOp[];
  // Where each number went (never on top of each other — placeShapeLabels).
  labels: ShapeDrawingLabel[];
  // Each banding arrow's box.
  arrows: ShapeLabelBox[];
};

// Helvetica's widths (em) — near enough to size a number's box without a canvas to measure it on.
const CHAR_EM: Record<string, number> = { ".": 0.278, ",": 0.278, " ": 0.278, "-": 0.333, R: 0.722, W: 0.944, H: 0.722, "×": 0.584, "°": 0.4 };
function textWidth(text: string, size: number, bold = false): number {
  let em = 0;
  for (const ch of text) em += CHAR_EM[ch] ?? (/[0-9]/.test(ch) ? 0.556 : 0.6);
  return em * size * (bold ? 1.04 : 1);
}

type LabelRequest = ShapeLabelRequest & { text: string; arc: boolean };

// An arrowhead at `tip`, coming from `from` (px) — a filled triangle.
function arrowHeadPoints(tip: ShapePoint, from: ShapePoint, size: number): ShapePoint[] {
  const d = unit(sub(tip, from));
  const n: ShapePoint = [-d[1], d[0]];
  const base = sub(tip, mul(d, size));
  return [tip, add(base, mul(n, size * 0.42)), sub(base, mul(n, size * 0.42))];
}

// A point `t` (0–1) of the way along a line (px), and which way the line runs there.
function alongLine(line: ShapePoint[], t: number): { point: ShapePoint; direction: ShapePoint } | null {
  if (line.length < 2) return null;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    const l = len(sub(line[i + 1], line[i]));
    lengths.push(l);
    total += l;
  }
  if (!(total > 0)) return null;
  let target = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 0; i < lengths.length; i += 1) {
    if (target <= lengths[i] || i === lengths.length - 1) {
      const k = lengths[i] > 0 ? Math.min(1, target / lengths[i]) : 0;
      return { point: add(line[i], mul(sub(line[i + 1], line[i]), k)), direction: unit(sub(line[i + 1], line[i])) };
    }
    target -= lengths[i];
  }
  return null;
}

// Whether a point is inside a closed outline (px — its last point joins back to its first).
function insideOutline(p: ShapePoint, outline: ShapePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i += 1) {
    const a = outline[i];
    const b = outline[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// The box round some points, grown by `pad`.
function boxAround(points: ShapePoint[], pad: number): ShapeLabelBox {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { left: Math.min(...xs) - pad, top: Math.min(...ys) - pad, right: Math.max(...xs) + pad, bottom: Math.max(...ys) + pad };
}

export function shapeDrawingOps(shape: CutlistShape, opts: ShapeDrawingOptions = {}): ShapeDrawing {
  const width = Math.max(16, opts.width ?? 360);
  const height = Math.max(16, opts.height ?? 240);
  const fontSize = Math.max(4, opts.fontSize ?? 10);
  const k = fontSize / 10;
  const showDimensions = opts.showDimensions ?? true;
  const showArrows = opts.showBandingArrows ?? true;
  const bandColor = opts.bandColor ?? SHAPE_PRINT_BAND_COLOR;
  const ops: ShapeDrawingOp[] = [];
  if (opts.background) ops.push({ kind: "rect", x: 0, y: 0, w: width, h: height, r: 0, fill: opts.background });
  const geometry = shapeGeometry(shape);
  if (!geometry.valid) return { width, height, scale: 1, toPx: (p) => p, ops, labels: [], arrows: [] };

  const isTemplate = isTemplateShapeKind(shape.kind);
  const labelH = fontSize + 5 * k;
  const labelW = (text: string) => textWidth(text, fontSize) + 6 * k;
  const bandWidth = 3 * k;
  const arrowHead = 5 * k;
  const arrowShaft = 6 * k;
  const arrowGap = bandWidth / 2 + 1.5 * k;
  const arrowReach = arrowGap + arrowHead + arrowShaft + 2 * k;

  // ---- How far out its numbers go (px), so there's room for them round it. A template's dimension lines sit 22 out; a
  // custom outline's segment lengths sit just off each segment, its cut-outs' dimension lines (shapeCutoutDimensions —
  // where each is, how wide, how deep; a cut corner's set-backs) out past those, stacked, and its Width and Height lines
  // out past them. (A segment whose length a cut-out's dimension already says: not said again.)
  const cutouts = !showDimensions || isTemplate ? null : shapeCutoutDimensions(shape);
  const covered = new Set(cutouts?.covered ?? []);
  const outerTier = (normal: ShapePoint) =>
    1 + Math.max(-1, ...(cutouts?.dims ?? []).filter((d) => d.normal[0] === normal[0] && d.normal[1] === normal[1]).map((d) => d.tier ?? 0));
  const dims: ShapeDimension[] = !showDimensions
    ? []
    : isTemplate
      ? templateDimensions(shape)
      : [...(cutouts?.dims ?? []), ...customOuterDimensions(geometry).map((d) => ({ ...d, tier: outerTier(d.normal) }))];
  const segmentReach = (normal: ShapePoint, text: string) => (Math.abs(normal[0]) * labelW(text) + Math.abs(normal[1]) * labelH) / 2 + 3 * k;
  const segmentTexts = isTemplate ? [] : geometry.edges.map((edge) => (covered.has(edge.index) ? "" : formatShapeMm(edge.vertexLength)));
  const widestSegment = Math.max(0, ...segmentTexts.filter(Boolean).map((text) => labelW(text)));
  const dimOffsetFor = (d: ShapeDimension) => {
    if (isTemplate) return 22 * k;
    // (Clear of the segment labels on that side: across them, then half its own label — and a tier further out each.)
    const across = Math.abs(d.normal[0]) * (widestSegment + 3 * k) + Math.abs(d.normal[1]) * (labelH + 3 * k);
    const own = (Math.abs(d.normal[0]) * labelW(formatShapeMm(d.value)) + Math.abs(d.normal[1]) * labelH) / 2;
    const tierStep = Math.abs(d.normal[0]) * (widestSegment + 6 * k) + Math.abs(d.normal[1]) * (labelH + 6 * k);
    return Math.max(22 * k, across + 2 * k + own) + (d.tier ?? 0) * Math.max(tierStep, 14 * k);
  };
  let padX = showArrows ? arrowReach : 2 * k;
  let padY = padX;
  if (showDimensions) {
    padX = Math.max(padX, widestSegment + 4 * k, 12 * k + labelH);
    padY = Math.max(padY, labelH + 4 * k, 12 * k + labelH);
    for (const d of dims) {
      const reach = dimOffsetFor(d) + (Math.abs(d.normal[0]) * labelW(formatShapeMm(d.value)) + Math.abs(d.normal[1]) * labelH) / 2 + 2 * k;
      if (Math.abs(d.normal[0]) > 0.5) padX = Math.max(padX, reach);
      else padY = Math.max(padY, reach);
    }
  }

  // ---- Fitted and centred.
  const b = geometry.bounds;
  const scale = Math.max(1e-6, Math.min(Math.max(4, width - 2 * padX) / Math.max(b.width, 1e-6), Math.max(4, height - 2 * padY) / Math.max(b.height, 1e-6)));
  const ox = width / 2 - (b.minX + b.width / 2) * scale;
  const oy = height / 2 - (b.minY + b.height / 2) * scale;
  const toPx = (p: ShapePoint): ShapePoint => [ox + p[0] * scale, oy + p[1] * scale];

  // ---- The outline and its banding.
  const outline = dedupe(sampleShapeOutline(geometry, PRINT_SAMPLING).map((sample) => sample.point), true).map(toPx);
  ops.push({
    kind: "path",
    points: outline,
    closed: true,
    fill: opts.fill ?? "#E9EFF8",
    fillOpacity: opts.fillOpacity ?? 1,
    stroke: opts.stroke ?? "#334155",
    lineWidth: 1 * k,
    lineJoin: "round",
  });
  const chains = shapeBandedChains(geometry);
  const bandLines = chains.map((chain) => ({ chain, line: shapeChainPoints(geometry, chain, PRINT_SAMPLING).map(toPx) })).filter((item) => item.line.length >= 2);
  for (const { chain, line } of bandLines) {
    ops.push({ kind: "path", points: line, closed: false, stroke: bandColor, lineWidth: bandWidth, lineCap: chain.closed ? "butt" : "round", lineJoin: "round" });
  }

  // ---- An arrow at each banded stretch (one at its middle; one going the whole way round, four along it), inside the
  // shape pointing out at it — so its numbers keep the outside to themselves. Where the piece is too narrow there for
  // one, a shorter one; too narrow even for that, one outside pointing in. (Outward: the shape's own way round — a
  // uniform scale keeps it.)
  const arrows: ShapeLabelBox[] = [];
  if (showArrows) {
    for (const { chain, line } of bandLines) {
      const count = chain.closed ? 4 : 1;
      for (let j = 0; j < count; j += 1) {
        const at = alongLine(line, chain.closed ? (j + 0.5) / count : 0.5);
        if (!at) continue;
        const n: ShapePoint = [at.direction[1] * geometry.orientation, -at.direction[0] * geometry.orientation];
        // side -1: in from the banding; 1: out from it.
        const arrowAt = (side: number, shaft: number) => {
          const tip = add(at.point, mul(n, side * arrowGap));
          const base = add(tip, mul(n, side * arrowHead));
          const tail = add(base, mul(n, side * shaft));
          return { base, tail, head: arrowHeadPoints(tip, tail, arrowHead), clear: add(tail, mul(n, side * 1.5 * k)) };
        };
        const fitsInside = (arrow: ReturnType<typeof arrowAt>) => [...arrow.head, arrow.tail, arrow.clear].every((p) => insideOutline(p, outline));
        const { base, tail, head } = [arrowAt(-1, arrowShaft), arrowAt(-1, 1.5 * k)].find(fitsInside) ?? arrowAt(1, arrowShaft);
        ops.push({ kind: "path", points: [tail, base], closed: false, stroke: bandColor, lineWidth: 1.1 * k, lineCap: "round" });
        ops.push({ kind: "path", points: head, closed: true, fill: bandColor, stroke: bandColor, lineWidth: 0.4 * k, lineJoin: "round" });
        arrows.push(boxAround([...head, tail], 1 * k));
      }
    }
  }

  const labels: ShapeDrawingLabel[] = [];
  if (showDimensions) {
    // ---- Dimension lines: a template's own (its Width and Height among them); a custom outline's cut-outs placed, and
    // its Width and Height round the box it's in.
    const requests: LabelRequest[] = [];
    const dimOps: ShapeDrawingOp[] = [];
    for (const d of dims) {
      const n = d.normal;
      const offset = dimOffsetFor(d);
      const a = add(toPx(d.from), mul(n, offset));
      const z = add(toPx(d.to), mul(n, offset));
      const extension = (anchorMm: ShapePoint, end: ShapePoint) => {
        const anchor = toPx(anchorMm);
        dimOps.push({ kind: "path", points: [add(anchor, mul(n, 3 * k)), add(anchor, mul(n, dot(sub(end, anchor), n) + 3 * k))], closed: false, stroke: SOFT, lineWidth: 0.5 * k });
      };
      extension(d.fromAnchor, a);
      extension(d.toAnchor, z);
      dimOps.push({ kind: "path", points: [a, z], closed: false, stroke: SOFT, lineWidth: 0.6 * k });
      const m = mid(a, z);
      if (len(sub(z, a)) > 3 * arrowHead) {
        dimOps.push({ kind: "path", points: arrowHeadPoints(a, m, 4.5 * k), closed: true, fill: SOFT });
        dimOps.push({ kind: "path", points: arrowHeadPoints(z, m, 4.5 * k), closed: true, fill: SOFT });
      }
      const text = formatShapeMm(d.value);
      requests.push({ id: `dim:${d.key}`, text, arc: false, width: labelW(text), height: labelH, x: m[0], y: m[1], anchor: m, normal: n });
    }
    ops.push(...dimOps);

    // ---- A custom outline's segments: each one's length (end to end), just off its middle (a curve's: off the middle
    // of its curve) — and a curve's height too.
    if (!isTemplate) {
      for (const edge of geometry.edges) {
        if (edge.vertexLength < 1e-6 || !segmentTexts[edge.index]) continue;
        const n = edge.normal;
        const on = toPx(edge.curve ? edge.curve.mid : mid(edge.startVertex, edge.endVertex));
        const text = segmentTexts[edge.index];
        const natural = add(on, mul(n, segmentReach(n, text)));
        requests.push({ id: `seg:${edge.index}`, text, arc: false, width: labelW(text), height: labelH, x: natural[0], y: natural[1], anchor: on, normal: n });
      }
      for (const edge of geometry.edges) {
        if (!edge.curve) continue;
        const chordMid = toPx(mid(edge.startVertex, edge.endVertex));
        const arcMid = toPx(edge.curve.mid);
        const text = formatShapeMm(edge.curve.height);
        const w = textWidth(text, fontSize) + fontSize * 1.05 + 6 * k;
        const depth = len(sub(arcMid, chordMid));
        // (Between its chord and its curve when there's room; else out past its length.)
        const inside = depth > labelH + 4 * k;
        const towards = inside ? unit(sub(chordMid, arcMid)) : edge.normal;
        const natural = inside ? mid(chordMid, arcMid) : add(arcMid, mul(edge.normal, labelH * 1.5 + 6 * k));
        requests.push({ id: `arc:${edge.index}`, text, arc: true, width: w, height: labelH, x: natural[0], y: natural[1], anchor: arcMid, normal: towards });
      }
    }

    // ---- Rounded corners' radii (a square one shows nothing on paper).
    for (const corner of geometry.corners) {
      if (!(corner.radius > 0)) continue;
      const anchor = toPx(corner.tip);
      const natural = add(anchor, mul(corner.outward, 10 * k + labelH / 2));
      const text = `R${formatShapeMm(corner.radius)}`;
      requests.push({ id: `rad:${corner.index}`, text, arc: false, width: textWidth(text, fontSize) + 6 * k, height: labelH, x: natural[0], y: natural[1], anchor, normal: corner.outward });
    }

    // ---- Corners that aren't square: their angle, a little arc between their edges and the number just past it.
    for (const corner of shapeCornerAngles(geometry)) {
      const at = toPx(corner.point);
      const count = geometry.edges.length;
      const edgePx = Math.min(geometry.edges[(corner.index - 1 + count) % count].vertexLength, geometry.edges[corner.index].vertexLength) * scale;
      const radius = Math.max(6 * k, Math.min(18 * k, edgePx * 0.4));
      const start = Math.atan2(corner.from[1], corner.from[0]);
      let sweep = Math.atan2(corner.to[1], corner.to[0]) - start;
      // (The short way round: the side its edges open towards.)
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      const arc: ShapePoint[] = [];
      for (let s = 0; s <= 12; s += 1) {
        const t = start + (sweep * s) / 12;
        arc.push([at[0] + radius * Math.cos(t), at[1] + radius * Math.sin(t)]);
      }
      ops.push({ kind: "path", points: arc, closed: false, stroke: INK, lineWidth: 1 * k, lineCap: "round" });
      const text = formatShapeDegrees(corner.degrees);
      const anchor = add(at, mul(corner.between, radius));
      const natural = add(at, mul(corner.between, radius + 4 * k + labelH / 2));
      requests.push({ id: `ang:${corner.index}`, text, arc: false, width: textWidth(text, fontSize) + 6 * k, height: labelH, x: natural[0], y: natural[1], anchor, normal: corner.between });
    }

    const placed = placeShapeLabels(requests, { width, height }, { gap: 2 * k, step: 4 * k, reach: 16, margin: 1.5 * k, obstacles: arrows });
    // Leaders first (under the numbers), from a moved number's edge back to what it's for.
    for (const label of placed) {
      if (!label.moved || Math.hypot(label.anchor[0] - label.cx, label.anchor[1] - label.cy) <= label.height / 2 + 3 * k) continue;
      const start: ShapePoint = [
        Math.min(Math.max(label.anchor[0], label.cx - label.width / 2), label.cx + label.width / 2),
        Math.min(Math.max(label.anchor[1], label.cy - label.height / 2), label.cy + label.height / 2),
      ];
      ops.push({ kind: "path", points: [start, label.anchor], closed: false, stroke: SOFT, lineWidth: 0.5 * k });
      ops.push({ kind: "path", points: arrowHeadPoints(label.anchor, start, 3.5 * k), closed: true, fill: SOFT });
    }
    for (const label of placed) {
      const box: ShapeLabelBox = { left: label.cx - label.width / 2, top: label.cy - label.height / 2, right: label.cx + label.width / 2, bottom: label.cy + label.height / 2 };
      ops.push({ kind: "rect", x: box.left, y: box.top, w: label.width, h: label.height, r: 2 * k, fill: "#FFFFFF" });
      const baseline = label.cy + fontSize * 0.35;
      if (label.arc) {
        // A little arc before the number (drawn — a ⌒ isn't in every print font).
        const glyphW = fontSize * 0.85;
        const textW = textWidth(label.text, fontSize);
        const left = label.cx - (glyphW + fontSize * 0.2 + textW) / 2;
        const cy = label.cy + fontSize * 0.12;
        const glyph: ShapePoint[] = [];
        for (let s = 0; s <= 10; s += 1) {
          const t = Math.PI + (Math.PI * s) / 10;
          glyph.push([left + glyphW / 2 + (glyphW / 2) * Math.cos(t), cy + fontSize * 0.42 * Math.sin(t)]);
        }
        ops.push({ kind: "path", points: glyph, closed: false, stroke: INK, lineWidth: 0.8 * k, lineCap: "round", lineJoin: "round" });
        ops.push({ kind: "text", x: left + glyphW + fontSize * 0.2, y: baseline, text: label.text, size: fontSize, color: INK, align: "left" });
      } else {
        ops.push({ kind: "text", x: label.cx, y: baseline, text: label.text, size: fontSize, color: INK, align: "center" });
      }
      labels.push({ id: label.id, text: label.text, box, moved: label.moved });
    }
  }
  return { width, height, scale, toPx, ops, labels, arrows };
}

// A custom outline's Width (over the top) and Height (down the left), from the points of it furthest out each way.
function customOuterDimensions(geometry: ShapeGeometry): ShapeDimension[] {
  const b = geometry.bounds;
  const outline = sampleShapeOutline(geometry, PRINT_SAMPLING).map((sample) => sample.point);
  if (!outline.length) return [];
  const extreme = (pick: (p: ShapePoint) => number, best: (a: number, z: number) => boolean) =>
    outline.reduce((found, p) => (best(pick(p), pick(found)) ? p : found), outline[0]);
  const leftmost = extreme((p) => p[0] + p[1] * 1e-9, (a, z) => a < z);
  const rightmost = extreme((p) => p[0] - p[1] * 1e-9, (a, z) => a > z);
  const topmost = extreme((p) => p[1] + p[0] * 1e-9, (a, z) => a < z);
  const bottommost = extreme((p) => p[1] + p[0] * 1e-9, (a, z) => a > z);
  return [
    { key: "W", value: b.width, from: [b.minX, b.minY], to: [b.maxX, b.minY], fromAnchor: leftmost, toAnchor: rightmost, normal: [0, -1] },
    { key: "H", value: b.height, from: [b.minX, b.minY], to: [b.minX, b.maxY], fromAnchor: topmost, toAnchor: bottommost, normal: [-1, 0] },
  ];
}

// ---- As SVG.

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const svgPoints = (points: ShapePoint[]) => points.map((p, i) => `${i ? "L" : "M"} ${round2(p[0])} ${round2(p[1])}`).join(" ");

export function shapeDrawingOpsToSvg(drawing: Pick<ShapeDrawing, "width" | "height" | "ops">): string {
  const parts: string[] = [];
  for (const op of drawing.ops) {
    if (op.kind === "path") {
      if (op.points.length < 2) continue;
      const attrs = [
        `d="${svgPoints(op.points)}${op.closed ? " Z" : ""}"`,
        `fill="${op.fill ? escapeXml(op.fill) : "none"}"`,
        op.fill && op.fillOpacity !== undefined && op.fillOpacity !== 1 ? `fill-opacity="${round2(op.fillOpacity)}"` : "",
        op.stroke ? `stroke="${escapeXml(op.stroke)}" stroke-width="${round2(op.lineWidth ?? 1)}"` : "",
        op.stroke ? `stroke-linecap="${op.lineCap ?? "butt"}" stroke-linejoin="${op.lineJoin ?? "miter"}"` : "",
      ].filter(Boolean);
      parts.push(`<path ${attrs.join(" ")}/>`);
    } else if (op.kind === "rect") {
      const stroke = op.stroke ? ` stroke="${escapeXml(op.stroke)}" stroke-width="${round2(op.lineWidth ?? 1)}"` : "";
      parts.push(`<rect x="${round2(op.x)}" y="${round2(op.y)}" width="${round2(op.w)}" height="${round2(op.h)}" rx="${round2(op.r)}" fill="${escapeXml(op.fill)}"${stroke}/>`);
    } else {
      const anchor = op.align === "center" ? "middle" : op.align === "right" ? "end" : "start";
      parts.push(
        `<text x="${round2(op.x)}" y="${round2(op.y)}" font-family="${FONT_FAMILY}" font-size="${round2(op.size)}"${op.bold ? ' font-weight="bold"' : ""} fill="${escapeXml(op.color)}" text-anchor="${anchor}">${escapeXml(op.text)}</text>`,
      );
    }
  }
  const w = round2(drawing.width);
  const h = round2(drawing.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}

// The drawing as a standalone SVG's markup.
export function shapeDrawingSvg(shape: CutlistShape, opts: ShapeDrawingOptions = {}): string {
  return shapeDrawingOpsToSvg(shapeDrawingOps(shape, opts));
}

// ---- As a PNG (a browser only): drawn straight onto a canvas, step by step — no SVG to load, so it works the same in
// every browser. `pixelRatio`: canvas pixels per px (default 2, sharp enough to print).

// Its steps drawn onto a canvas (its context already scaled to px).
export function paintShapeDrawingOps(ctx: CanvasRenderingContext2D, ops: ShapeDrawingOp[]): void {
  for (const op of ops) {
    if (op.kind === "path") {
      if (op.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(op.points[0][0], op.points[0][1]);
      for (let i = 1; i < op.points.length; i += 1) ctx.lineTo(op.points[i][0], op.points[i][1]);
      if (op.closed) ctx.closePath();
      if (op.fill) {
        ctx.globalAlpha = op.fillOpacity ?? 1;
        ctx.fillStyle = op.fill;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (op.stroke) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.lineWidth ?? 1;
        ctx.lineCap = op.lineCap ?? "butt";
        ctx.lineJoin = op.lineJoin ?? "miter";
        ctx.stroke();
      }
    } else if (op.kind === "rect") {
      ctx.beginPath();
      const r = Math.max(0, Math.min(op.r, op.w / 2, op.h / 2));
      ctx.moveTo(op.x + r, op.y);
      ctx.lineTo(op.x + op.w - r, op.y);
      ctx.arcTo(op.x + op.w, op.y, op.x + op.w, op.y + r, r);
      ctx.lineTo(op.x + op.w, op.y + op.h - r);
      ctx.arcTo(op.x + op.w, op.y + op.h, op.x + op.w - r, op.y + op.h, r);
      ctx.lineTo(op.x + r, op.y + op.h);
      ctx.arcTo(op.x, op.y + op.h, op.x, op.y + op.h - r, r);
      ctx.lineTo(op.x, op.y + r);
      ctx.arcTo(op.x, op.y, op.x + r, op.y, r);
      ctx.closePath();
      ctx.fillStyle = op.fill;
      ctx.fill();
      if (op.stroke) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.lineWidth ?? 1;
        ctx.stroke();
      }
    } else {
      ctx.font = `${op.bold ? "bold " : ""}${op.size}px ${FONT_FAMILY}`;
      ctx.fillStyle = op.color;
      ctx.textAlign = op.align;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(op.text, op.x, op.y);
    }
  }
}

export function shapeDrawingPngDataUrl(shape: CutlistShape, opts: ShapeDrawingOptions & { pixelRatio?: number } = {}): Promise<string> {
  if (typeof document === "undefined") return Promise.resolve("");
  try {
    const drawing = shapeDrawingOps(shape, opts);
    const ratio = Math.max(0.25, opts.pixelRatio ?? 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(drawing.width * ratio));
    canvas.height = Math.max(1, Math.round(drawing.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve("");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintShapeDrawingOps(ctx, drawing.ops);
    return Promise.resolve(canvas.toDataURL("image/png"));
  } catch (error) {
    return Promise.reject(error);
  }
}
