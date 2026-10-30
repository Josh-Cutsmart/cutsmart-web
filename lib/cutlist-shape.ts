// A cutlist part that isn't a plain rectangle — an L-shaped corner shelf, a notched top, an angled corner shelf, a
// U-shaped benchtop, or any outline drawn by hand (a "Custom" part type: Company Settings › Part Types). Kept exact —
// its corner points and radii in mm — so labels, printed cutlists and DXF export can draw it later from the same data.
// Pure geometry, no React: components/cutlist-shape-editor.tsx draws and edits it.
//
// The shape: a template (its sizes in `params`) or a custom outline (`points`), the radius of any corner set by hand
// (`radii`, by corner — the rest take the default: 25 inside, square outside), and which edges are edge banded
// (`banded`, by edge — edge i runs from corner i to corner i + 1). Coordinates are mm with y running down the page.
// A custom outline's segments can be curves (`bulges`, by segment): see below.
//
// Curves: a segment's bulge is DXF's — tan(θ / 4), θ the angle its arc turns through — signed as DXF signs it for the
// drawing as it's seen (y up the page, as a DXF has it): + the arc runs anticlockwise from its start to its end (bowing
// to the right of the way it runs), − clockwise. So it goes into a DXF as it is (lib/cutlist-shape-dxf.ts). 0 or
// missing: straight. A corner's radius only applies between two straight segments — one next to a curve is sharp.

export type ShapePoint = [number, number];
export type CutlistShapeKind = "rect" | "L" | "U" | "notch" | "angled" | "custom";
export type CutlistShapeTemplateKind = Exclude<CutlistShapeKind, "custom">;

export type CutlistShape = {
  version: 1;
  kind: CutlistShapeKind;
  params: Record<string, number>;
  points?: ShapePoint[];
  // A custom outline's curved segments, by segment (i: point i to point i + 1, the last back to point 0) — optional,
  // only ever on a custom outline; read it with shapeBulges.
  bulges?: Record<number, number>;
  radii: Record<number, number>;
  banded: number[];
  // What the piece is — one of the company's other part types (Company Settings › Part Types) and its category.
  // Optional: a shape from before there was one is a flat piece, as it always was.
  base?: CutlistShapeBase;
  // A Cabinetry one (isCabinetShape): the drawing is its top view, and this is the rest of it — see
  // lib/cutlist-cabinet-shape.ts for what's made from it.
  cabinet?: CutlistShapeCabinet;
};

// A part type's category, as Company Settings › Part Types has them ("" — none).
export type CutlistShapeBaseCategory = "cabinetry" | "panel" | "extra" | "door" | "drawer" | "";
export type CutlistShapeBase = { partType: string; category: string };

// What each edge of a custom cabinet's top view is: a panel at the back, an end panel, or open to its doors.
export type CabinetEdgeRole = "back" | "end" | "doors";
export type CutlistShapeCabinet = {
  // Its height (mm) — 720 unless set.
  height: number;
  // Each edge's role, by edge (i: corner i to corner i + 1) — any not set takes its default
  // (lib/cutlist-cabinet-shape.ts's defaultCabinetEdgeRoles).
  roles?: Record<number, CabinetEdgeRole>;
  // By corner, where two backs meet: true — the back after the corner (edge i) runs through, not the one before it.
  throughBacks?: Record<number, boolean>;
  // How many shelves of each (defaults: 0 fixed, 1 adjustable).
  fixedShelves?: number;
  adjustableShelves?: number;
};

// A cabinet's height when it's not been set.
export const DEFAULT_CABINET_HEIGHT = 720;

// A cabinet: what it is is one of the company's Cabinetry part types. (Everything else is a flat piece.)
export function isCabinetShape(shape: CutlistShape | null | undefined): boolean {
  return String(shape?.base?.category ?? "").trim().toLowerCase() === "cabinetry";
}

// An inside corner can't be cut square by a router, so it's always rounded unless set to 0 by hand.
export const DEFAULT_INSIDE_RADIUS = 25;
// The smallest leg, notch or cut a template's sizes are kept to — so a shape can never fold over on itself.
const MIN_PART_MM = 1;
// The deepest a curve can bow: a bulge of 2 (its arc turns through about 254°, its height the whole of its length).
export const MAX_SHAPE_BULGE = 2;
// A bulge smaller than this is a straight line.
const BULGE_EPSILON = 1e-6;
// Two segments that meet within this of straight (a curve flowing into a line, say) band as one run.
export const SMOOTH_JOIN_RADIANS = (2 * Math.PI) / 180;

export const CUTLIST_SHAPE_KINDS: Array<{ kind: CutlistShapeKind; label: string }> = [
  { kind: "rect", label: "Rectangle" },
  { kind: "L", label: "L corner" },
  { kind: "U", label: "U shape" },
  { kind: "notch", label: "Notch" },
  { kind: "angled", label: "Angled" },
  { kind: "custom", label: "Custom" },
];

export const CUTLIST_SHAPE_TEMPLATE_DEFAULTS: Record<CutlistShapeTemplateKind, Record<string, number>> = {
  rect: { W: 900, H: 600 },
  // A = the back leg's depth, B = the side leg's width.
  L: { W: 1311, H: 1138, A: 466, B: 400 },
  // A = the back's depth, B / C = the left / right legs' widths.
  U: { W: 2400, H: 1200, A: 600, B: 600, C: 600 },
  // nw × nh = the notch out of the top right corner.
  notch: { W: 900, H: 560, nw: 200, nh: 120 },
  // cx × cy = the corner cut off the bottom right.
  angled: { W: 900, H: 900, cx: 450, cy: 450 },
};
const TEMPLATE_PARAM_KEYS: Record<CutlistShapeTemplateKind, string[]> = {
  rect: ["W", "H"],
  L: ["W", "H", "A", "B"],
  U: ["W", "H", "A", "B", "C"],
  notch: ["W", "H", "nw", "nh"],
  angled: ["W", "H", "cx", "cy"],
};

export function isTemplateShapeKind(kind: unknown): kind is CutlistShapeTemplateKind {
  return kind === "rect" || kind === "L" || kind === "U" || kind === "notch" || kind === "angled";
}

export function cutlistShapeKindLabel(kind: CutlistShapeKind): string {
  return CUTLIST_SHAPE_KINDS.find((option) => option.kind === kind)?.label ?? "Shape";
}

// What a template's size is called, for the box it's typed into.
export function cutlistShapeParamLabel(kind: CutlistShapeKind, key: string): string {
  if (key === "W") return "Width";
  if (key === "H") return "Height";
  if (kind === "L") return key === "A" ? "Back leg depth" : "Side leg width";
  if (kind === "U") return key === "A" ? "Back depth" : key === "B" ? "Left leg width" : "Right leg width";
  if (kind === "notch") return key === "nw" ? "Notch width" : "Notch depth";
  if (kind === "angled") return key === "cx" ? "Corner cut across" : "Corner cut up";
  return key;
}

// ---- Small vector helpers.
const sub = (a: ShapePoint, b: ShapePoint): ShapePoint => [a[0] - b[0], a[1] - b[1]];
const add = (a: ShapePoint, b: ShapePoint): ShapePoint => [a[0] + b[0], a[1] + b[1]];
const mul = (a: ShapePoint, k: number): ShapePoint => [a[0] * k, a[1] * k];
const dot = (a: ShapePoint, b: ShapePoint) => a[0] * b[0] + a[1] * b[1];
const cross = (a: ShapePoint, b: ShapePoint) => a[0] * b[1] - a[1] * b[0];
const len = (a: ShapePoint) => Math.hypot(a[0], a[1]);
const unit = (a: ShapePoint): ShapePoint => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
};
export const distanceBetween = (a: ShapePoint, b: ShapePoint) => len(sub(a, b));
// mm to a tenth (what's typed), and positions to a thousandth (a 45° line's points aren't whole mm — kept as near
// exact as is useful, without the float noise).
const roundTenth = (value: number) => Math.round(value * 10) / 10;
const roundFine = (value: number) => Math.round(value * 1000) / 1000;
const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), Math.max(lo, hi));
const rotate = (a: ShapePoint, angle: number): ShapePoint => [
  a[0] * Math.cos(angle) - a[1] * Math.sin(angle),
  a[0] * Math.sin(angle) + a[1] * Math.cos(angle),
];
const midpoint = (a: ShapePoint, b: ShapePoint): ShapePoint => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const TWO_PI = Math.PI * 2;
const wrapAngle = (value: number) => ((value % TWO_PI) + TWO_PI) % TWO_PI;

// A template's sizes kept in range, so it can't turn itself inside out: every leg, notch and cut at least 1mm and
// short of the whole. `changed` (the size just typed) wins where two have to share — a U's legs, the width between
// them.
export function clampTemplateParams(
  kind: CutlistShapeTemplateKind,
  raw: Record<string, number> | undefined,
  changed?: string,
): Record<string, number> {
  const defaults = CUTLIST_SHAPE_TEMPLATE_DEFAULTS[kind];
  const read = (key: string) => {
    const value = Number(raw?.[key]);
    return Number.isFinite(value) && value > 0 ? roundTenth(value) : defaults[key];
  };
  const p: Record<string, number> = {};
  for (const key of TEMPLATE_PARAM_KEYS[kind]) p[key] = read(key);
  const m = MIN_PART_MM;
  switch (kind) {
    case "rect":
      p.W = Math.max(p.W, m);
      p.H = Math.max(p.H, m);
      break;
    case "L":
      p.W = Math.max(p.W, 2 * m);
      p.H = Math.max(p.H, 2 * m);
      p.A = clamp(p.A, m, p.H - m);
      p.B = clamp(p.B, m, p.W - m);
      break;
    case "U":
      p.W = Math.max(p.W, 3 * m);
      p.H = Math.max(p.H, 2 * m);
      p.A = clamp(p.A, m, p.H - m);
      if (changed === "C") {
        p.C = clamp(p.C, m, p.W - 2 * m);
        p.B = clamp(p.B, m, p.W - m - p.C);
      } else {
        p.B = clamp(p.B, m, p.W - 2 * m);
        p.C = clamp(p.C, m, p.W - m - p.B);
      }
      break;
    case "notch":
      p.W = Math.max(p.W, 2 * m);
      p.H = Math.max(p.H, 2 * m);
      p.nw = clamp(p.nw, m, p.W - m);
      p.nh = clamp(p.nh, m, p.H - m);
      break;
    case "angled":
      p.W = Math.max(p.W, 2 * m);
      p.H = Math.max(p.H, 2 * m);
      p.cx = clamp(p.cx, m, p.W - m);
      p.cy = clamp(p.cy, m, p.H - m);
      break;
  }
  return p;
}

export function createTemplateShape(kind: CutlistShapeTemplateKind, params?: Record<string, number>): CutlistShape {
  return { version: 1, kind, params: clampTemplateParams(kind, params ?? CUTLIST_SHAPE_TEMPLATE_DEFAULTS[kind]), radii: {}, banded: [] };
}

export function createCustomShape(points: ShapePoint[] = []): CutlistShape {
  return { version: 1, kind: "custom", params: {}, points: points.map((p) => [p[0], p[1]] as ShapePoint), radii: {}, banded: [] };
}

// A plain rectangle at a row's own Height × Width — for a Custom row that's never had a shape drawn (brought in from a
// spreadsheet, or its part type made Custom later): its clashing (1L / 2L / 1S / 2S) as the edges banded. No size yet:
// the template's own.
export function rectShapeFromSize(width: unknown, height: unknown, clashLeft?: unknown, clashRight?: unknown): CutlistShape {
  const num = (value: unknown) => {
    const match = String(value ?? "").replace(/,/g, ".").match(/\d+(?:\.\d+)?/);
    const n = match ? Number.parseFloat(match[0]) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const W = num(width);
  const H = num(height);
  const shape = W && H ? createTemplateShape("rect", { W, H }) : createTemplateShape("rect");
  // Edges: 0 top and 2 bottom (the width), 1 right and 3 left (the height).
  const longEdges = shape.params.W >= shape.params.H ? [0, 2] : [1, 3];
  const shortEdges = longEdges[0] === 0 ? [1, 3] : [0, 2];
  const banded = new Set<number>();
  for (const raw of [clashLeft, clashRight]) {
    const token = String(raw ?? "").trim().toUpperCase();
    const edges = token.endsWith("L") ? longEdges : token.endsWith("S") ? shortEdges : null;
    if (!edges || !/^[12][LS]$/.test(token)) continue;
    edges.slice(0, token.startsWith("2") ? 2 : 1).forEach((edge) => banded.add(edge));
  }
  return { ...shape, banded: Array.from(banded).sort((a, b) => a - b) };
}

// The shape a cutlist row is cut to, if it's one: its own, or — a Custom part type's row without one — a rectangle at
// its size (rectShapeFromSize). null: an ordinary rectangular part.
export function shapeForCutlistRow(
  row: { shape?: CutlistShape; width?: unknown; height?: unknown; clashLeft?: unknown; clashRight?: unknown; clashing?: unknown },
  isCustomPartType: boolean,
): CutlistShape | null {
  if (row.shape) return row.shape;
  if (!isCustomPartType) return null;
  const tokens = String(row.clashing ?? "").trim().toUpperCase().split(/\s+/);
  return rectShapeFromSize(row.width, row.height, row.clashLeft || tokens[0], row.clashRight || tokens[1]);
}

// Its corner points, in order.
export function shapeVertices(shape: CutlistShape): ShapePoint[] {
  if (shape.kind === "custom" || !isTemplateShapeKind(shape.kind)) {
    return (shape.points ?? []).map((p) => [p[0], p[1]] as ShapePoint);
  }
  const p = clampTemplateParams(shape.kind, shape.params);
  const { W, H } = p;
  switch (shape.kind) {
    case "rect":
      return [[0, 0], [W, 0], [W, H], [0, H]];
    case "L":
      return [[0, 0], [W, 0], [W, p.A], [p.B, p.A], [p.B, H], [0, H]];
    case "U":
      return [[0, 0], [W, 0], [W, H], [W - p.C, H], [W - p.C, p.A], [p.B, p.A], [p.B, H], [0, H]];
    case "notch":
      return [[0, 0], [W - p.nw, 0], [W - p.nw, p.nh], [W, p.nh], [W, H], [0, H]];
    case "angled":
      return [[0, 0], [W, 0], [W, H - p.cy], [W - p.cx, H], [0, H]];
  }
}

// Shoelace — positive one way round, negative the other (y down: positive is clockwise on screen).
export function signedPolygonArea(points: ShapePoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

export type ShapeBounds = { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
export function pointsBounds(points: ShapePoint[]): ShapeBounds {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// ---- Curved segments.

// A segment's curve, worked out from its two ends and its bulge (null: straight).
export type ShapeSegmentArc = {
  bulge: number;
  // The angle it turns through, signed the way an SVG or canvas arc is (+: angles increasing, from x towards y —
  // clockwise on the screen), and where it starts on its circle.
  sweep: number;
  startAngle: number;
  radius: number;
  center: ShapePoint;
  // The middle of the arc, and its height there (the sagitta: how far that is off the straight line between its ends).
  mid: ShapePoint;
  height: number;
  // Round the curve.
  length: number;
  // SVG's arc flags.
  largeArc: 0 | 1;
  svgSweep: 0 | 1;
};

export function shapeSegmentArc(a: ShapePoint, b: ShapePoint, bulge: number): ShapeSegmentArc | null {
  const chord = sub(b, a);
  const c = len(chord);
  if (!(c > 1e-9) || !Number.isFinite(bulge) || Math.abs(bulge) < BULGE_EPSILON) return null;
  const value = clamp(bulge, -MAX_SHAPE_BULGE, MAX_SHAPE_BULGE);
  // (y down: + bows to the left of the chord as the numbers run, which is to the right as the drawing's seen.)
  const side: ShapePoint = [-chord[1] / c, chord[0] / c];
  const height = (value * c) / 2;
  const mid = add(midpoint(a, b), mul(side, height));
  const radius = (c * (1 + value * value)) / (4 * Math.abs(value));
  const center = sub(mid, mul(side, Math.sign(value) * radius));
  const sweep = -4 * Math.atan(value);
  return {
    bulge: value,
    sweep,
    startAngle: Math.atan2(a[1] - center[1], a[0] - center[0]),
    radius,
    center,
    mid,
    height: Math.abs(height),
    length: radius * Math.abs(sweep),
    largeArc: Math.abs(sweep) > Math.PI ? 1 : 0,
    svgSweep: sweep > 0 ? 1 : 0,
  };
}

// Which way it's heading as it leaves its start, and as it gets to its end (unit vectors).
export function segmentTangents(a: ShapePoint, b: ShapePoint, arc: ShapeSegmentArc | null): { start: ShapePoint; end: ShapePoint } {
  const d = unit(sub(b, a));
  if (!arc) return { start: d, end: d };
  return { start: rotate(d, -arc.sweep / 2), end: rotate(d, arc.sweep / 2) };
}

// A bulge for a curve `height` high (signed as the bulge is) over a segment `chord` long — and back.
export function bulgeFromHeight(chord: number, height: number): number {
  if (!(chord > 1e-9)) return 0;
  return clamp((2 * height) / chord, -MAX_SHAPE_BULGE, MAX_SHAPE_BULGE);
}
export function heightFromBulge(chord: number, bulge: number): number {
  return (clamp(bulge, -MAX_SHAPE_BULGE, MAX_SHAPE_BULGE) * Math.max(0, chord)) / 2;
}

// An arc's points, its start to its end, close enough together for `toleranceMm` (how far the straight bits between
// them can be off the curve) and no further apart than `stepRadians`.
export type ShapeSampleOptions = { stepRadians?: number; toleranceMm?: number };
function arcStep(radius: number, options: ShapeSampleOptions | undefined, fallback: number): number {
  let step = options?.stepRadians ?? fallback;
  const tolerance = options?.toleranceMm;
  if (tolerance !== undefined && tolerance > 0 && radius > tolerance) step = Math.min(step, 2 * Math.acos(1 - tolerance / radius));
  return clamp(step, Math.PI / 1440, Math.PI / 4);
}
export function segmentArcPoints(arc: ShapeSegmentArc, options?: ShapeSampleOptions): ShapePoint[] {
  const step = arcStep(arc.radius, options ?? { toleranceMm: 0.5 }, Math.PI / 36);
  const steps = Math.max(2, Math.ceil(Math.abs(arc.sweep) / step));
  const out: ShapePoint[] = [];
  for (let s = 0; s <= steps; s += 1) {
    const theta = arc.startAngle + (arc.sweep * s) / steps;
    out.push([arc.center[0] + arc.radius * Math.cos(theta), arc.center[1] + arc.radius * Math.sin(theta)]);
  }
  return out;
}

// The arc's own points furthest out each way (where it's level or upright) — for the box round it.
function arcExtremes(arc: ShapeSegmentArc): ShapePoint[] {
  const out: ShapePoint[] = [];
  for (let k = 0; k < 4; k += 1) {
    const phi = (k * Math.PI) / 2;
    const along = arc.sweep > 0 ? wrapAngle(phi - arc.startAngle) : wrapAngle(arc.startAngle - phi);
    if (along <= Math.abs(arc.sweep) + 1e-12) out.push([arc.center[0] + arc.radius * Math.cos(phi), arc.center[1] + arc.radius * Math.sin(phi)]);
  }
  return out;
}

// Area by Green's theorem — each piece of the outline's share (½∮ x dy − y dx), a straight line's and an arc's.
const lineArea = (a: ShapePoint, b: ShapePoint) => (a[0] * b[1] - b[0] * a[1]) / 2;
function arcArea(center: ShapePoint, radius: number, startAngle: number, sweep: number): number {
  const endAngle = startAngle + sweep;
  return (
    (radius * center[0] * (Math.sin(endAngle) - Math.sin(startAngle)) -
      radius * center[1] * (Math.cos(endAngle) - Math.cos(startAngle)) +
      radius * radius * sweep) /
    2
  );
}

// A custom outline's curves (nothing for a template): each by its segment, kept in range, straight ones left out.
export function shapeBulges(shape: CutlistShape): Record<number, number> {
  if (shape.kind !== "custom" || !shape.bulges || typeof shape.bulges !== "object") return {};
  const count = (shape.points ?? []).length;
  const out: Record<number, number> = {};
  for (const [key, raw] of Object.entries(shape.bulges)) {
    const index = Number(key);
    const value = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= count || !Number.isFinite(value) || Math.abs(value) < BULGE_EPSILON) continue;
    out[index] = clamp(value, -MAX_SHAPE_BULGE, MAX_SHAPE_BULGE);
  }
  return out;
}

// Each segment's curve (null: straight) — every segment of a closed outline, or of one still being drawn (`closed`
// false) all but the last point's way back to the first.
function outlineArcs(points: ShapePoint[], bulges: Record<number, number>, closed: boolean): Array<ShapeSegmentArc | null> {
  const n = points.length;
  const count = closed ? (n >= 3 ? n : 0) : Math.max(0, n - 1);
  const out: Array<ShapeSegmentArc | null> = [];
  for (let i = 0; i < count; i += 1) out.push(shapeSegmentArc(points[i], points[(i + 1) % n], bulges[i] ?? 0));
  return out;
}

// The box round an outline, its curves and all (a curve can bow out past its ends). (A rounded corner never reaches
// past its corner point.)
function outlineBounds(points: ShapePoint[], arcs: Array<ShapeSegmentArc | null>): ShapeBounds {
  const all = [...points];
  for (const arc of arcs) if (arc) all.push(...arcExtremes(arc));
  return pointsBounds(all);
}

// The box round a shape as it's cut — its curves included. (shapeOuterSize: the same, rounded to a tenth.)
export function shapeBounds(shape: CutlistShape): ShapeBounds {
  const vertices = shapeVertices(shape);
  return outlineBounds(vertices, outlineArcs(vertices, shapeBulges(shape), true));
}

export type ShapeCorner = {
  index: number;
  point: ShapePoint;
  // Inside (concave): the material wraps round it — rounded 25 unless set otherwise.
  inside: boolean;
  // The angle between its two edges (φ), in radians.
  angle: number;
  // The radius it's cut at (what was asked for, made smaller if its edges are too short for it), and what was asked.
  radius: number;
  requestedRadius: number;
  explicit: boolean;
  // Where the curve meets the edge before it (A) and after it (B), and the curve's centre.
  start: ShapePoint;
  end: ShapePoint;
  center: ShapePoint | null;
  // SVG's arc sweep flag (y down).
  sweep: 0 | 1;
  // Away from the material — where its R label goes.
  outward: ShapePoint;
  // The middle of its curve (the corner itself when square).
  tip: ShapePoint;
  // A curved segment either side: it can't be rounded, so it's sharp whatever its radius says.
  nextToCurve: boolean;
  // Its two segments meet (near enough) in a straight line — a curve flowing into a line: banded as one run.
  smooth: boolean;
};

export type ShapeEdge = {
  index: number;
  // Corner i to corner i + 1...
  startVertex: ShapePoint;
  endVertex: ShapePoint;
  // ...its straight part: from the end of corner i's curve to the start of corner i + 1's. (A curved one: corner to
  // corner — the corners either side of a curve are sharp.)
  from: ShapePoint;
  to: ShapePoint;
  // Its straight part's length — or, curved, the length round its curve (what it takes to band it).
  length: number;
  vertexLength: number;
  // Away from the material (a curved one: its chord's).
  normal: ShapePoint;
  run: number;
  banded: boolean;
  // Its curve (a custom outline's segment with a bulge), null when it's straight.
  curve: ShapeSegmentArc | null;
};

// Edges joined by a rounded corner — or meeting smoothly, a curve flowing into a line — band as one: a run ends at a
// sharp corner (or, every corner rounded or smooth, it's the whole outline).
export type ShapeRun = { index: number; edges: number[]; corners: number[]; banded: boolean };

export type ShapeGeometry = {
  vertices: ShapePoint[];
  orientation: 1 | -1;
  corners: ShapeCorner[];
  edges: ShapeEdge[];
  runs: ShapeRun[];
  bounds: ShapeBounds;
  areaMm2: number;
  bandedLengthMm: number;
  // Separate lengths of tape it takes (each with two ends — Company Settings' excess per end).
  bandedStrips: number;
  valid: boolean;
};

function cornersFor(
  vertices: ShapePoint[],
  orientation: 1 | -1,
  radii: Record<number, number>,
  arcs: Array<ShapeSegmentArc | null> = [],
): ShapeCorner[] {
  const n = vertices.length;
  return vertices.map((p, index) => {
    const arcBefore = arcs[(index - 1 + n) % n] ?? null;
    const arcAfter = arcs[index] ?? null;
    const nextToCurve = Boolean(arcBefore || arcAfter);
    const incoming = segmentTangents(vertices[(index - 1 + n) % n], p, arcBefore).end;
    const outgoing = segmentTangents(p, vertices[(index + 1) % n], arcAfter).start;
    const smooth = len(incoming) > 0 && len(outgoing) > 0 && dot(incoming, outgoing) >= Math.cos(SMOOTH_JOIN_RADIANS);
    const prev = vertices[(index - 1 + n) % n];
    const next = vertices[(index + 1) % n];
    const lenPrev = distanceBetween(prev, p);
    const lenNext = distanceBetween(next, p);
    const a = unit(sub(prev, p));
    const b = unit(sub(next, p));
    const angle = Math.acos(clamp(dot(a, b), -1, 1));
    const turn = cross(sub(p, prev), sub(next, p));
    const inside = turn * orientation < 0;
    const explicitValue = Number(radii[index]);
    const explicit = Number.isFinite(explicitValue) && explicitValue >= 0 && radii[index] !== undefined;
    const requestedRadius = explicit ? explicitValue : inside ? DEFAULT_INSIDE_RADIUS : 0;
    // Away from the material: between the edges on a concave corner, the other way on a convex one (a straight-through
    // point: its edges' own outward side).
    const bisector = unit(add(a, b));
    const edgeNormal = unit(add(normalOf(prev, p, orientation), normalOf(p, next, orientation)));
    const outward: ShapePoint = len(add(a, b)) < 1e-9 ? edgeNormal : inside ? bisector : mul(bisector, -1);
    const square = {
      index,
      point: p,
      inside,
      angle,
      radius: 0,
      requestedRadius,
      explicit,
      start: p,
      end: p,
      center: null,
      sweep: (turn > 0 ? 1 : 0) as 0 | 1,
      outward,
      tip: p,
      nextToCurve,
      smooth,
    } satisfies ShapeCorner;
    if (nextToCurve || requestedRadius <= 0 || lenPrev < 1e-9 || lenNext < 1e-9 || angle < 1e-6 || angle > Math.PI - 1e-6) return square;
    const half = angle / 2;
    let tangent = requestedRadius / Math.tan(half);
    let radius = requestedRadius;
    const maxTangent = Math.min(lenPrev, lenNext) / 2;
    if (tangent > maxTangent) {
      tangent = maxTangent;
      radius = tangent * Math.tan(half);
    }
    const center = add(p, mul(bisector, radius / Math.sin(half)));
    return {
      ...square,
      radius,
      start: add(p, mul(a, tangent)),
      end: add(p, mul(b, tangent)),
      center,
      tip: add(center, mul(bisector, -radius)),
    };
  });
}

// An edge's outward normal (unit), for a polygon wound `orientation` (1: positive area).
function normalOf(from: ShapePoint, to: ShapePoint, orientation: 1 | -1): ShapePoint {
  const d = unit(sub(to, from));
  return [d[1] * orientation, -d[0] * orientation];
}

// Every curve's length (radius × how far it turns).
const arcLength = (corner: ShapeCorner) => (corner.radius > 0 ? corner.radius * (Math.PI - corner.angle) : 0);

export function shapeGeometry(shape: CutlistShape): ShapeGeometry {
  const vertices = shapeVertices(shape);
  const n = vertices.length;
  const arcs = outlineArcs(vertices, shapeBulges(shape), true);
  // (Its curves count towards which way round it goes, and whether there's anything there at all.)
  const signed = signedPolygonArea(vertices);
  const curvedSigned = arcs.reduce((sum, arc, i) => (arc ? sum + arcArea(arc.center, arc.radius, arc.startAngle, arc.sweep) - lineArea(vertices[i], vertices[(i + 1) % n]) : sum), signed);
  const orientation: 1 | -1 = (Math.abs(curvedSigned) > 1e-6 ? curvedSigned : signed) < 0 ? -1 : 1;
  const bounds = outlineBounds(vertices, arcs);
  const valid = n >= 3 && Math.abs(curvedSigned) > 1e-6;
  if (!valid) {
    return { vertices, orientation, corners: [], edges: [], runs: [], bounds, areaMm2: 0, bandedLengthMm: 0, bandedStrips: 0, valid: false };
  }
  const corners = cornersFor(vertices, orientation, shape.radii ?? {}, arcs);
  const bandedSet = new Set((shape.banded ?? []).filter((edge) => Number.isInteger(edge) && edge >= 0 && edge < n));

  // Runs: start at a sharp corner (not rounded, not smooth) and gather the edges till the next one.
  const joins = corners.map((corner) => corner.radius > 0 || corner.smooth);
  const square = joins.map((joined) => !joined);
  const firstSquare = square.indexOf(true);
  const runEdges: number[][] = [];
  const runCorners: number[][] = [];
  if (firstSquare < 0) {
    runEdges.push(vertices.map((_, i) => i));
    runCorners.push(vertices.map((_, i) => i));
  } else {
    let edgesHere = [firstSquare];
    let cornersHere: number[] = [];
    for (let step = 1; step < n; step += 1) {
      const i = (firstSquare + step) % n;
      if (square[i]) {
        runEdges.push(edgesHere);
        runCorners.push(cornersHere);
        edgesHere = [i];
        cornersHere = [];
      } else {
        edgesHere.push(i);
        cornersHere.push(i);
      }
    }
    runEdges.push(edgesHere);
    runCorners.push(cornersHere);
  }
  const runOfEdge = new Array<number>(n).fill(0);
  runEdges.forEach((edges, run) => edges.forEach((edge) => (runOfEdge[edge] = run)));

  const edges: ShapeEdge[] = vertices.map((startVertex, index) => {
    const endVertex = vertices[(index + 1) % n];
    const from = corners[index].end;
    const to = corners[(index + 1) % n].start;
    const curve = arcs[index] ?? null;
    return {
      index,
      startVertex,
      endVertex,
      from,
      to,
      length: curve ? curve.length : distanceBetween(from, to),
      vertexLength: distanceBetween(startVertex, endVertex),
      normal: normalOf(startVertex, endVertex, orientation),
      run: runOfEdge[index],
      banded: bandedSet.has(index),
      curve,
    };
  });
  const runs: ShapeRun[] = runEdges.map((edgeList, index) => ({
    index,
    edges: edgeList,
    corners: runCorners[index],
    banded: edgeList.every((edge) => bandedSet.has(edge)),
  }));

  // Banded: the straight parts (and curved segments) of banded edges, and each rounded corner between two banded edges.
  let bandedLengthMm = 0;
  let bandedStrips = 0;
  for (const edge of edges) if (edge.banded) bandedLengthMm += edge.length;
  for (const corner of corners) {
    const before = (corner.index - 1 + n) % n;
    if (corner.radius > 0 && bandedSet.has(before) && bandedSet.has(corner.index)) bandedLengthMm += arcLength(corner);
  }
  for (const edge of edges) {
    if (!edge.banded) continue;
    const before = (edge.index - 1 + n) % n;
    const joined = joins[edge.index] && bandedSet.has(before);
    if (!joined) bandedStrips += 1;
  }
  if (bandedSet.size && !bandedStrips) bandedStrips = 1;

  // Its area, exactly: round its outline — each rounded corner's curve, then the edge from it (a line or a curve).
  let signedArea = 0;
  for (const corner of corners) {
    if (corner.radius > 0 && corner.center) {
      const startAngle = Math.atan2(corner.start[1] - corner.center[1], corner.start[0] - corner.center[0]);
      signedArea += arcArea(corner.center, corner.radius, startAngle, (corner.sweep ? 1 : -1) * (Math.PI - corner.angle));
    }
    const edge = edges[corner.index];
    signedArea += edge.curve ? arcArea(edge.curve.center, edge.curve.radius, edge.curve.startAngle, edge.curve.sweep) : lineArea(edge.from, edge.to);
  }
  const areaMm2 = Math.abs(signedArea);
  return { vertices, orientation, corners, edges, runs, bounds, areaMm2, bandedLengthMm, bandedStrips, valid };
}

// A corner's curve as points (A to B), a few degrees apart.
export function cornerArcPoints(corner: ShapeCorner, stepRadians = Math.PI / 36): ShapePoint[] {
  if (!(corner.radius > 0) || !corner.center) return [corner.point];
  const c = corner.center;
  const startAngle = Math.atan2(corner.start[1] - c[1], corner.start[0] - c[0]);
  const delta = (corner.sweep ? 1 : -1) * (Math.PI - corner.angle);
  const steps = Math.max(2, Math.ceil(Math.abs(delta) / stepRadians));
  const out: ShapePoint[] = [];
  for (let s = 0; s <= steps; s += 1) {
    const theta = startAngle + (delta * s) / steps;
    out.push([c[0] + corner.radius * Math.cos(theta), c[1] + corner.radius * Math.sin(theta)]);
  }
  return out;
}

// The outline as points (its curves sampled), in order — each with the edge it runs along to the next point, or the
// corner it's on (for the 3D view's sides, and the area).
// (Its edges too, for its curved segments' points — given just its corners, every edge is drawn straight.)
// `options`: how finely its curves are sampled (shapeOutlinePolyline in lib/cutlist-shape-render.ts: finely enough to
// print); left out, 5° apart — the corners as they always were.
export type OutlineSample = { point: ShapePoint; edge: number | null; corner: number | null };
export function sampleShapeOutline(
  geometry: Pick<ShapeGeometry, "corners"> & { edges?: ShapeEdge[] },
  options?: ShapeSampleOptions,
): OutlineSample[] {
  const out: OutlineSample[] = [];
  const n = geometry.corners.length;
  geometry.corners.forEach((corner) => {
    const arc = cornerArcPoints(corner, options ? arcStep(corner.radius, options, Math.PI / 36) : undefined);
    arc.forEach((point, i) => {
      const last = i === arc.length - 1;
      out.push({ point, edge: last ? corner.index : null, corner: last ? null : corner.index });
    });
    // (A curved edge: its points between its two corners, along that edge.)
    const curve = geometry.edges?.[corner.index]?.curve;
    if (curve) {
      const along = segmentArcPoints(curve, options);
      for (let i = 1; i < along.length - 1; i += 1) out.push({ point: along[i], edge: corner.index, corner: null });
    }
  });
  // (The last point of each corner leads along the edge that starts there — corner i's edge is i.)
  return n ? out : [];
}

// The outline as an SVG path, through `toScreen` (a uniform scale and shift — so its curves stay circles). Its edges'
// curves too, when it's given its edges.
const fmt = (value: number) => String(Math.round(value * 100) / 100);
function svgArcTo(arc: ShapeSegmentArc, end: ShapePoint, toScreen: (p: ShapePoint) => ShapePoint, scale: number): string {
  const r = fmt(arc.radius * scale);
  const s = toScreen(end);
  return `A ${r} ${r} 0 ${arc.largeArc} ${arc.svgSweep} ${fmt(s[0])} ${fmt(s[1])}`;
}
export function shapeOutlinePath(
  geometry: Pick<ShapeGeometry, "corners"> & { edges?: ShapeEdge[] },
  toScreen: (p: ShapePoint) => ShapePoint,
  scale: number,
): string {
  const corners = geometry.corners;
  if (!corners.length) return "";
  const xy = (p: ShapePoint) => {
    const s = toScreen(p);
    return `${fmt(s[0])} ${fmt(s[1])}`;
  };
  const first = corners[0];
  let d = `M ${xy(first.radius > 0 ? first.end : first.point)}`;
  for (let k = 1; k <= corners.length; k += 1) {
    const corner = corners[k % corners.length];
    const curve = geometry.edges?.[k - 1]?.curve;
    const reach = corner.radius > 0 ? corner.start : corner.point;
    d += curve ? ` ${svgArcTo(curve, reach, toScreen, scale)}` : ` L ${xy(reach)}`;
    if (corner.radius > 0) {
      const r = fmt(corner.radius * scale);
      d += ` A ${r} ${r} 0 0 ${corner.sweep} ${xy(corner.end)}`;
    }
  }
  return `${d} Z`;
}

// ---- Chains: a stretch of the outline drawn as one line — edges one after another, each joined to the next through
// the corner between them (rounded, or smooth) — closed when it goes the whole way round. (A run's highlight, and each
// banded stretch: one line, so nothing doubles up where its edges meet a curve.)
export type ShapeChain = { edges: number[]; closed: boolean };

export function shapeRunChain(geometry: ShapeGeometry, runIndex: number): ShapeChain | null {
  const run = geometry.runs[runIndex];
  if (!run || !run.edges.length) return null;
  return { edges: [...run.edges], closed: run.corners.length === geometry.corners.length };
}

// Each stretch of banding: banded edges one after another, through the corners that join them.
export function shapeBandedChains(geometry: ShapeGeometry): ShapeChain[] {
  const n = geometry.edges.length;
  if (!n || !geometry.valid) return [];
  const banded = geometry.edges.map((edge) => edge.banded);
  const joins = geometry.corners.map((corner) => corner.radius > 0 || corner.smooth);
  // (Edge i carries on from edge i − 1: both banded, and joined at corner i.)
  const carriesOn = (i: number) => joins[i] && banded[i] && banded[(i - 1 + n) % n];
  if (banded.every(Boolean) && joins.every(Boolean)) return [{ edges: banded.map((_, i) => i), closed: true }];
  const chains: ShapeChain[] = [];
  for (let i = 0; i < n; i += 1) {
    if (!banded[i] || carriesOn(i)) continue;
    const edges = [i];
    for (let j = (i + 1) % n; j !== i && carriesOn(j); j = (j + 1) % n) edges.push(j);
    chains.push({ edges, closed: false });
  }
  return chains;
}

// A chain as one SVG path, through `toScreen` (as shapeOutlinePath).
export function shapeChainPath(geometry: ShapeGeometry, chain: ShapeChain | null, toScreen: (p: ShapePoint) => ShapePoint, scale: number): string {
  const n = geometry.corners.length;
  if (!chain || !chain.edges.length || !n) return "";
  const xy = (p: ShapePoint) => {
    const s = toScreen(p);
    return `${fmt(s[0])} ${fmt(s[1])}`;
  };
  let d = `M ${xy(geometry.edges[chain.edges[0]].from)}`;
  chain.edges.forEach((edgeIndex, k) => {
    const edge = geometry.edges[edgeIndex];
    d += edge.curve ? ` ${svgArcTo(edge.curve, edge.to, toScreen, scale)}` : ` L ${xy(edge.to)}`;
    if (k === chain.edges.length - 1 && !chain.closed) return;
    const corner = geometry.corners[(edgeIndex + 1) % n];
    if (corner.radius > 0) {
      const r = fmt(corner.radius * scale);
      d += ` A ${r} ${r} 0 0 ${corner.sweep} ${xy(corner.end)}`;
    }
  });
  return chain.closed ? `${d} Z` : d;
}

// A chain as points (mm), its curves sampled (`options` as sampleShapeOutline's) — a closed one ends back on its first.
export function shapeChainPoints(geometry: ShapeGeometry, chain: ShapeChain | null, options?: ShapeSampleOptions): ShapePoint[] {
  const n = geometry.corners.length;
  if (!chain || !chain.edges.length || !n) return [];
  const out: ShapePoint[] = [];
  const push = (p: ShapePoint) => {
    const last = out[out.length - 1];
    if (!last || distanceBetween(last, p) > 1e-9) out.push([p[0], p[1]]);
  };
  push(geometry.edges[chain.edges[0]].from);
  chain.edges.forEach((edgeIndex, k) => {
    const edge = geometry.edges[edgeIndex];
    if (edge.curve) segmentArcPoints(edge.curve, options).forEach(push);
    else push(edge.to);
    if (k === chain.edges.length - 1 && !chain.closed) return;
    const corner = geometry.corners[(edgeIndex + 1) % n];
    if (corner.radius > 0) cornerArcPoints(corner, options ? arcStep(corner.radius, options, Math.PI / 36) : undefined).forEach(push);
  });
  if (chain.closed && out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (distanceBetween(first, last) > 1e-9) out.push([first[0], first[1]]);
    else out[out.length - 1] = [first[0], first[1]];
  }
  return out;
}

export function cornerArcPath(corner: ShapeCorner, toScreen: (p: ShapePoint) => ShapePoint, scale: number): string {
  if (!(corner.radius > 0)) return "";
  const a = toScreen(corner.start);
  const b = toScreen(corner.end);
  const r = fmt(corner.radius * scale);
  return `M ${fmt(a[0])} ${fmt(a[1])} A ${r} ${r} 0 0 ${corner.sweep} ${fmt(b[0])} ${fmt(b[1])}`;
}

// A run banded or not: on, unless every edge in it already is — then off.
export function toggleShapeRunBanding(shape: CutlistShape, edgeIndex: number): CutlistShape {
  const geometry = shapeGeometry(shape);
  const run = geometry.runs.find((candidate) => candidate.edges.includes(edgeIndex));
  if (!run) return shape;
  const set = new Set(shape.banded);
  const allOn = run.edges.every((edge) => set.has(edge));
  for (const edge of run.edges) {
    if (allOn) set.delete(edge);
    else set.add(edge);
  }
  return { ...shape, banded: Array.from(set).sort((a, b) => a - b) };
}

export function setShapeCornerRadius(shape: CutlistShape, corner: number, radius: number): CutlistShape {
  const value = Math.max(0, roundTenth(Number(radius) || 0));
  return { ...shape, radii: { ...shape.radii, [corner]: value } };
}

// Its outer size: the box round it (its corner points, and any curve bowing out past them) — Width across (x), Height
// down (y). What a row's Height and Width are, and so what nesting and sheet counts go by.
export function shapeOuterSize(shape: CutlistShape): { width: number; height: number } {
  const bounds = shapeBounds(shape);
  return { width: roundTenth(bounds.width), height: roundTenth(bounds.height) };
}

// ---- Template dimension lines: each a size of the shape — between two points, offset outward (`normal`), its
// extension lines from `fromAnchor` / `toAnchor` on the shape.
export type ShapeDimension = {
  key: string;
  value: number;
  from: ShapePoint;
  to: ShapePoint;
  fromAnchor: ShapePoint;
  toAnchor: ShapePoint;
  normal: ShapePoint;
};
export function templateDimensions(shape: CutlistShape): ShapeDimension[] {
  if (!isTemplateShapeKind(shape.kind)) return [];
  const p = clampTemplateParams(shape.kind, shape.params);
  const { W, H } = p;
  const dim = (key: string, from: ShapePoint, to: ShapePoint, normal: ShapePoint, fromAnchor = from, toAnchor = to): ShapeDimension => ({
    key,
    value: p[key],
    from,
    to,
    fromAnchor,
    toAnchor,
    normal,
  });
  const up: ShapePoint = [0, -1];
  const down: ShapePoint = [0, 1];
  const left: ShapePoint = [-1, 0];
  const right: ShapePoint = [1, 0];
  const width = shape.kind === "notch" ? dim("W", [0, H], [W, H], down) : dim("W", [0, 0], [W, 0], up);
  const height = dim("H", [0, 0], [0, H], left);
  switch (shape.kind) {
    case "rect":
      return [width, height];
    case "L":
      return [width, height, dim("A", [W, 0], [W, p.A], right), dim("B", [0, H], [p.B, H], down)];
    case "U":
      return [
        width,
        height,
        dim("A", [W, 0], [W, p.A], right, [W, 0], [W - p.C, p.A]),
        dim("B", [0, H], [p.B, H], down),
        dim("C", [W - p.C, H], [W, H], down),
      ];
    case "notch":
      return [
        width,
        height,
        dim("nw", [W - p.nw, 0], [W, 0], up, [W - p.nw, 0], [W, p.nh]),
        dim("nh", [W, 0], [W, p.nh], right, [W - p.nw, 0], [W, p.nh]),
      ];
    case "angled":
      return [
        width,
        height,
        dim("cx", [W - p.cx, H], [W, H], down, [W - p.cx, H], [W, H - p.cy]),
        dim("cy", [W, H - p.cy], [W, H], right, [W, H - p.cy], [W - p.cx, H]),
      ];
  }
}

// ---- Custom outlines.

// A drawn segment made `length` long: its end moved along its own direction, every point after it moved with it. (The
// closing segment of a closed outline — it ends at the first point: its start moved back instead, the same thing.)
export function setCustomSegmentLength(points: ShapePoint[], index: number, length: number, closed: boolean): ShapePoint[] {
  const n = points.length;
  const target = Math.max(MIN_PART_MM, Number(length) || 0);
  const out = points.map((p) => [p[0], p[1]] as ShapePoint);
  if (closed && index === n - 1 && n >= 3) {
    const a = out[n - 1];
    const b = out[0];
    const dir = unit(sub(b, a));
    if (!len(dir)) return out;
    const delta = sub(add(a, mul(dir, target)), b);
    out[n - 1] = [roundFine(a[0] - delta[0]), roundFine(a[1] - delta[1])];
    return out;
  }
  if (index < 0 || index >= n - 1) return out;
  const a = out[index];
  const b = out[index + 1];
  const dir = unit(sub(b, a));
  if (!len(dir)) return out;
  const delta = sub(add(a, mul(dir, target)), b);
  for (let j = index + 1; j < n; j += 1) out[j] = [roundFine(out[j][0] + delta[0]), roundFine(out[j][1] + delta[1])];
  return out;
}

// Moved so its box starts at 0, 0 (how far, too — so a view showing it can stay put).
export function normalizeCustomPoints(points: ShapePoint[]): { points: ShapePoint[]; shift: ShapePoint } {
  const bounds = pointsBounds(points);
  const shift: ShapePoint = [bounds.minX, bounds.minY];
  return { points: points.map(([x, y]) => [roundFine(x - shift[0]), roundFine(y - shift[1])] as ShapePoint), shift };
}

// A custom outline moved so the box round it as it's cut — its curves too — starts at 0, 0 (and how far).
export function normalizeCustomShape(shape: CutlistShape): { shape: CutlistShape; shift: ShapePoint } {
  if (shape.kind !== "custom") return { shape, shift: [0, 0] };
  const bounds = shapeBounds(shape);
  const shift: ShapePoint = [bounds.minX, bounds.minY];
  const points = (shape.points ?? []).map(([x, y]) => [roundFine(x - shift[0]), roundFine(y - shift[1])] as ShapePoint);
  return { shape: { ...shape, points }, shift };
}

// ---- A custom outline's curves, changed. Each returns the shape as it'd be; the editor checks it doesn't cross itself
// (shapeSelfIntersects) before keeping it.

// Segment `index` bowed to `bulge` (0: straight again). No curves left: no `bulges` at all, as a shape never curved.
export function setCustomSegmentBulge(shape: CutlistShape, index: number, bulge: number): CutlistShape {
  if (shape.kind !== "custom") return shape;
  const next: Record<number, number> = { ...shapeBulges(shape) };
  const value = clamp(Number(bulge) || 0, -MAX_SHAPE_BULGE, MAX_SHAPE_BULGE);
  if (Math.abs(value) < BULGE_EPSILON) delete next[index];
  else next[index] = Math.round(value * 1e6) / 1e6;
  const out: CutlistShape = { ...shape };
  delete out.bulges;
  return Object.keys(next).length ? { ...out, bulges: next } : out;
}

// Which way round a custom outline goes (as ShapeGeometry's orientation).
function customOrientation(shape: CutlistShape): 1 | -1 {
  const points = shape.points ?? [];
  const n = points.length;
  const arcs = outlineArcs(points, shapeBulges(shape), true);
  const signed = arcs.reduce((sum, arc, i) => (arc ? sum + arcArea(arc.center, arc.radius, arc.startAngle, arc.sweep) - lineArea(points[i], points[(i + 1) % n]) : sum), signedPolygonArea(points));
  return signed < 0 ? -1 : 1;
}

// The bulge that bows segment `index` out, away from the material (a curve on a straight one starts that way).
export function outwardBulgeSign(shape: CutlistShape): 1 | -1 {
  return customOrientation(shape) === 1 ? -1 : 1;
}

// Segment `index` curved `height` mm high (its sagitta; 0: straight) — the side it already bows to, or out.
export function setCustomSegmentHeight(shape: CutlistShape, index: number, height: number): CutlistShape {
  const points = shape.points ?? [];
  const n = points.length;
  if (shape.kind !== "custom" || index < 0 || index >= n || n < 2) return shape;
  const chord = distanceBetween(points[index], points[(index + 1) % n]);
  const h = Math.max(0, roundTenth(Number(height) || 0));
  if (!(chord > 1e-9) || h <= 0) return setCustomSegmentBulge(shape, index, 0);
  const current = shapeBulges(shape)[index] ?? 0;
  const sign = current ? Math.sign(current) : outwardBulgeSign(shape);
  return setCustomSegmentBulge(shape, index, bulgeFromHeight(chord, sign * h));
}

// A segment made `length` long, as setCustomSegmentLength — a curved one keeping its height.
export function setCustomShapeSegmentLength(shape: CutlistShape, index: number, length: number, closed: boolean): CutlistShape {
  const points = shape.points ?? [];
  const n = points.length;
  const moved = setCustomSegmentLength(points, index, length, closed);
  const out: CutlistShape = { ...shape, points: moved };
  const bulge = shapeBulges(shape)[index];
  if (!bulge || n < 2) return out;
  const before = distanceBetween(points[index], points[(index + 1) % n]);
  const after = distanceBetween(moved[index], moved[(index + 1) % n]);
  return before > 1e-9 && after > 1e-9 ? setCustomSegmentBulge(out, index, (bulge * before) / after) : out;
}

// ---- Outlines that cross themselves: no good to cut. Each segment (its curve sampled) against every other — two that
// aren't next to each other mustn't touch at all, and two that are mustn't meet anywhere but the point they share
// (nor fold back along each other).

// Which side of the line a → b point p is (+ / −), as a distance (mm).
function sideOf(a: ShapePoint, b: ShapePoint, p: ShapePoint): number {
  const d = sub(b, a);
  const l = len(d);
  return l > 1e-12 ? cross(d, sub(p, a)) / l : distanceBetween(a, p);
}
const TOUCH_MM = 1e-6;
function onSegment(a: ShapePoint, b: ShapePoint, p: ShapePoint): boolean {
  return (
    Math.min(a[0], b[0]) - TOUCH_MM <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + TOUCH_MM &&
    Math.min(a[1], b[1]) - TOUCH_MM <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + TOUCH_MM
  );
}
// Two straight pieces touch or cross.
function piecesMeet(p1: ShapePoint, p2: ShapePoint, q1: ShapePoint, q2: ShapePoint): boolean {
  const d1 = sideOf(q1, q2, p1);
  const d2 = sideOf(q1, q2, p2);
  const d3 = sideOf(p1, p2, q1);
  const d4 = sideOf(p1, p2, q2);
  const opposite = (x: number, y: number) => (x > TOUCH_MM && y < -TOUCH_MM) || (x < -TOUCH_MM && y > TOUCH_MM);
  if (opposite(d1, d2) && opposite(d3, d4)) return true;
  return (
    (Math.abs(d1) <= TOUCH_MM && onSegment(q1, q2, p1)) ||
    (Math.abs(d2) <= TOUCH_MM && onSegment(q1, q2, p2)) ||
    (Math.abs(d3) <= TOUCH_MM && onSegment(p1, p2, q1)) ||
    (Math.abs(d4) <= TOUCH_MM && onSegment(p1, p2, q2))
  );
}
// Two pieces leaving the same point heading the same way (folding back along each other).
function foldsBack(shared: ShapePoint, a: ShapePoint, b: ShapePoint): boolean {
  const u = unit(sub(a, shared));
  const w = unit(sub(b, shared));
  return len(u) > 0 && len(w) > 0 && dot(u, w) > Math.cos((0.5 * Math.PI) / 180);
}

// A custom outline's points (closed, or still being drawn) cross or touch themselves. `bulges` as a shape's.
export function customOutlineSelfIntersects(points: ShapePoint[], bulges: Record<number, number> | undefined, closed: boolean): boolean {
  const n = points.length;
  const count = closed ? (n >= 3 ? n : 0) : Math.max(0, n - 1);
  if (count < 2) return false;
  const arcs = outlineArcs(points, bulges ?? {}, closed);
  // Each segment as straight pieces (a curve finely), and the box round it.
  const segments = arcs.map((arc, i) => {
    const line = arc ? segmentArcPoints(arc, { stepRadians: Math.PI / 48 }) : [points[i], points[(i + 1) % n]];
    return { line, box: pointsBounds(line), length: arc ? arc.length : distanceBetween(points[i], points[(i + 1) % n]) };
  });
  const apart = (a: ShapeBounds, b: ShapeBounds) =>
    a.maxX < b.minX - TOUCH_MM || b.maxX < a.minX - TOUCH_MM || a.maxY < b.minY - TOUCH_MM || b.maxY < a.minY - TOUCH_MM;
  for (let i = 0; i < count; i += 1) {
    const s = segments[i];
    if (s.length < TOUCH_MM) continue;
    for (let j = i + 1; j < count; j += 1) {
      const t = segments[j];
      if (t.length < TOUCH_MM || apart(s.box, t.box)) continue;
      // Next to each other: j straight after i (its end, j's start), or — closed — i the first, j the last (i's start,
      // j's end).
      const afterI = j === i + 1;
      const beforeI = closed && i === 0 && j === count - 1;
      const lastS = s.line.length - 2;
      const lastT = t.line.length - 2;
      for (let a = 0; a <= lastS; a += 1) {
        for (let b = 0; b <= lastT; b += 1) {
          const sharedAfter = afterI && a === lastS && b === 0;
          const sharedBefore = beforeI && a === 0 && b === lastT;
          if (sharedAfter || sharedBefore) {
            // (The two pieces either side of the point they share: only folding back along each other counts.)
            const shared = sharedAfter ? s.line[a + 1] : s.line[0];
            const fromS = sharedAfter ? s.line[a] : s.line[1];
            const fromT = sharedAfter ? t.line[1] : t.line[b];
            if (foldsBack(shared, fromS, fromT)) return true;
            continue;
          }
          if (piecesMeet(s.line[a], s.line[a + 1], t.line[b], t.line[b + 1])) return true;
        }
      }
    }
  }
  return false;
}

// A shape's outline crosses (or touches) itself — a custom one drawn so, or curved so. (A template never does.)
export function shapeSelfIntersects(shape: CutlistShape): boolean {
  if (shape.kind !== "custom") return false;
  return customOutlineSelfIntersects(shape.points ?? [], shapeBulges(shape), true);
}

// Where a click or tap puts the next point of a drawing. Snap on: onto a point already there (within 12px — the first
// one closes it), else its direction to the nearest 45°; along a level or upright line, in line with another point's x
// or y (within 8px — a dotted guide shows it); its length to 10mm unless it's lined up. Snap off: freehand, to 1mm.
// The first point closes the outline either way.
export type CustomSnap = {
  point: ShapePoint;
  closes: boolean;
  snappedTo: number | null;
  guide: { from: ShapePoint; to: ShapePoint } | null;
  // The segment to it from the last point: its length and angle (degrees, 0 to the right, counting anticlockwise).
  length: number;
  angle: number;
};
export function snapCustomPoint(points: ShapePoint[], raw: ShapePoint, options: { snap: boolean; mmPerPx: number }): CustomSnap {
  const last = points[points.length - 1] ?? null;
  const measure = (point: ShapePoint): Pick<CustomSnap, "length" | "angle"> => {
    if (!last) return { length: 0, angle: 0 };
    const v = sub(point, last);
    const degrees = (-Math.atan2(v[1], v[0]) * 180) / Math.PI;
    return { length: len(v), angle: ((Math.round(degrees * 10) / 10) % 360 + 360) % 360 };
  };
  const done = (point: ShapePoint, extra?: Partial<CustomSnap>): CustomSnap => ({
    point,
    closes: false,
    snappedTo: null,
    guide: null,
    ...measure(point),
    ...extra,
  });
  const pointTolerance = 12 * options.mmPerPx;
  if (points.length >= 3 && distanceBetween(raw, points[0]) <= pointTolerance) {
    return done([points[0][0], points[0][1]], { closes: true, snappedTo: 0 });
  }
  if (!options.snap) return done([Math.round(raw[0]), Math.round(raw[1])]);
  let nearest = -1;
  let nearestDistance = Infinity;
  points.forEach((p, index) => {
    const d = distanceBetween(raw, p);
    if (d <= pointTolerance && d < nearestDistance) {
      nearest = index;
      nearestDistance = d;
    }
  });
  if (nearest >= 0 && nearest !== points.length - 1) {
    return done([points[nearest][0], points[nearest][1]], { snappedTo: nearest });
  }
  if (!last) return done([Math.round(raw[0] / 10) * 10, Math.round(raw[1] / 10) * 10]);
  const v = sub(raw, last);
  if (len(v) < 1e-9) return done([last[0], last[1]]);
  const step = Math.PI / 4;
  const locked = Math.round(Math.atan2(v[1], v[0]) / step) * step;
  const dir: ShapePoint = [Math.abs(Math.cos(locked)) < 1e-9 ? 0 : Math.cos(locked), Math.abs(Math.sin(locked)) < 1e-9 ? 0 : Math.sin(locked)];
  const along = Math.max(0, dot(v, dir));
  const alignTolerance = 8 * options.mmPerPx;
  const horizontal = dir[1] === 0;
  const vertical = dir[0] === 0;
  if (horizontal || vertical) {
    const axis = horizontal ? 0 : 1;
    const target = last[axis] + dir[axis] * along;
    let best: ShapePoint | null = null;
    let bestDistance = Infinity;
    for (let index = 0; index < points.length - 1; index += 1) {
      const d = Math.abs(points[index][axis] - target);
      if (d <= alignTolerance && d < bestDistance) {
        best = points[index];
        bestDistance = d;
      }
    }
    if (best) {
      const lined: ShapePoint = horizontal ? [best[0], last[1]] : [last[0], best[1]];
      if (distanceBetween(lined, last) > 1e-9) return done(lined, { guide: { from: best, to: lined } });
    }
  }
  const rounded = Math.max(10, Math.round(along / 10) * 10);
  return done([roundFine(last[0] + dir[0] * rounded), roundFine(last[1] + dir[1] * rounded)]);
}

// ---- The 3D view: the outline as an isometric slab — its sides that face the viewer (back to front) and its top.
export const isoProject = (p: ShapePoint, z: number): ShapePoint => [
  (p[0] - p[1]) * Math.cos(Math.PI / 6),
  (p[0] + p[1]) * Math.sin(Math.PI / 6) - z,
];
export type SlabFace = { points: ShapePoint[]; normal: ShapePoint; banded: boolean };
export function shapeSlabFaces(geometry: ShapeGeometry, thicknessMm: number): { top: ShapePoint[]; sides: SlabFace[] } {
  if (!geometry.valid) return { top: [], sides: [] };
  const outline = sampleShapeOutline(geometry);
  const n = geometry.corners.length;
  const edgeBanded = (edge: number) => geometry.edges[edge]?.banded ?? false;
  const sides: Array<SlabFace & { depth: number }> = [];
  outline.forEach((sample, i) => {
    const next = outline[(i + 1) % outline.length];
    const a = sample.point;
    const b = next.point;
    if (distanceBetween(a, b) < 1e-9) return;
    const normal = normalOf(a, b, geometry.orientation);
    // (Facing the viewer — who's off towards +x, +y.)
    if (normal[0] + normal[1] <= 1e-6) return;
    const banded =
      sample.edge !== null
        ? edgeBanded(sample.edge)
        : sample.corner !== null && edgeBanded(sample.corner) && edgeBanded((sample.corner - 1 + n) % n);
    sides.push({
      points: [isoProject(a, 0), isoProject(b, 0), isoProject(b, thicknessMm), isoProject(a, thicknessMm)],
      normal,
      banded,
      depth: (a[0] + a[1] + b[0] + b[1]) / 2,
    });
  });
  sides.sort((x, y) => x.depth - y.depth);
  return {
    top: outline.map((sample) => isoProject(sample.point, thicknessMm)),
    sides: sides.map(({ points, normal, banded }) => ({ points, normal, banded })),
  };
}

// ---- Labels that never sit on top of each other: each at its own spot if that's free, else moved out to the nearest
// free one — out along its normal first, then sideways — inside the view. A moved one gets a leader back to what it's
// for (anchor). (Screen px.)
export type ShapeLabelRequest = {
  id: string;
  width: number;
  height: number;
  // Its own spot (centre), what it belongs to, and which way is out.
  x: number;
  y: number;
  anchor: ShapePoint;
  normal: ShapePoint;
};
export type PlacedShapeLabel<T extends ShapeLabelRequest = ShapeLabelRequest> = T & { cx: number; cy: number; moved: boolean };
// `obstacles`: boxes already taken (arrows, say) that no label may sit on either.
export type ShapeLabelBox = { left: number; top: number; right: number; bottom: number };
export function placeShapeLabels<T extends ShapeLabelRequest>(
  requests: T[],
  view: { width: number; height: number },
  options?: { gap?: number; step?: number; reach?: number; margin?: number; obstacles?: ShapeLabelBox[] },
): Array<PlacedShapeLabel<T>> {
  const gap = options?.gap ?? 3;
  const step = options?.step ?? 6;
  const reach = options?.reach ?? 12;
  const margin = options?.margin ?? 4;
  const placed: ShapeLabelBox[] = (options?.obstacles ?? []).map((box) => ({ ...box }));
  // Every spot to try, nearest first (out a step costs less than sideways a step).
  const offsets: Array<{ out: number; side: number; cost: number }> = [];
  for (let out = 0; out <= reach; out += 1) {
    for (let side = -reach; side <= reach; side += 1) offsets.push({ out, side, cost: out + Math.abs(side) * 1.3 });
  }
  offsets.sort((a, b) => a.cost - b.cost);
  return requests.map((request) => {
    const normal = len(request.normal) > 1e-9 ? unit(request.normal) : ([0, -1] as ShapePoint);
    const tangent: ShapePoint = [-normal[1], normal[0]];
    const rectAt = (cx: number, cy: number) => ({
      left: cx - request.width / 2,
      top: cy - request.height / 2,
      right: cx + request.width / 2,
      bottom: cy + request.height / 2,
    });
    const fits = (rect: ReturnType<typeof rectAt>) =>
      rect.left >= margin &&
      rect.top >= margin &&
      rect.right <= view.width - margin &&
      rect.bottom <= view.height - margin &&
      placed.every(
        (other) =>
          rect.right + gap <= other.left ||
          rect.left - gap >= other.right ||
          rect.bottom + gap <= other.top ||
          rect.top - gap >= other.bottom,
      );
    let chosen: { cx: number; cy: number; moved: boolean } | null = null;
    for (const offset of offsets) {
      const cx = request.x + normal[0] * offset.out * step + tangent[0] * offset.side * step;
      const cy = request.y + normal[1] * offset.out * step + tangent[1] * offset.side * step;
      if (fits(rectAt(cx, cy))) {
        chosen = { cx, cy, moved: offset.out !== 0 || offset.side !== 0 };
        break;
      }
    }
    if (!chosen) {
      // (Hemmed in — against the edge of the view, say: the nearest free spot anywhere in it.)
      let best: { cx: number; cy: number; d: number } | null = null;
      for (let cy = margin + request.height / 2; cy <= view.height - margin - request.height / 2; cy += step) {
        for (let cx = margin + request.width / 2; cx <= view.width - margin - request.width / 2; cx += step) {
          const d = Math.hypot(cx - request.x, cy - request.y);
          if ((!best || d < best.d) && fits(rectAt(cx, cy))) best = { cx, cy, d };
        }
      }
      if (best) chosen = { cx: best.cx, cy: best.cy, moved: true };
    }
    if (!chosen) {
      // (Nowhere free: kept in the view, at its own spot as near as it can be.)
      const cx = clamp(request.x, margin + request.width / 2, view.width - margin - request.width / 2);
      const cy = clamp(request.y, margin + request.height / 2, view.height - margin - request.height / 2);
      chosen = { cx, cy, moved: Math.abs(cx - request.x) > 0.5 || Math.abs(cy - request.y) > 0.5 };
    }
    placed.push(rectAt(chosen.cx, chosen.cy));
    return { ...request, ...chosen };
  });
}

// ---- Words for it.
export function formatShapeMm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
export function formatShapeMetres(mm: number): string {
  return (Math.max(0, mm) / 1000).toFixed(2);
}
// "1.84 m banded" — a Custom row's Clashing cell.
export function shapeBandingSummary(shape: CutlistShape): string {
  const geometry = shapeGeometry(shape);
  return geometry.bandedLengthMm > 0 ? `${formatShapeMetres(geometry.bandedLengthMm)} m banded` : "No banding";
}
export function describeCutlistShape(shape: CutlistShape): string {
  const size = shapeOuterSize(shape);
  return `${cutlistShapeKindLabel(shape.kind)} ${formatShapeMm(size.width)} × ${formatShapeMm(size.height)}`;
}

// ---- Stored and read back. Firestore can't hold an array of arrays, so a custom outline's points are kept as {x, y};
// everything else as it is. Built in one fixed order, so two copies of the same shape compare equal as text. (A custom
// outline's curves, `bulges`, only when it has any — a shape without stores just as it always did.)
export function cutlistShapeForStorage(shape: CutlistShape): Record<string, unknown> {
  const params: Record<string, number> = {};
  for (const key of Object.keys(shape.params).sort()) params[key] = shape.params[key];
  const radii: Record<string, number> = {};
  for (const key of Object.keys(shape.radii).map(Number).filter(Number.isInteger).sort((a, b) => a - b)) radii[String(key)] = shape.radii[key];
  const curves = shapeBulges(shape);
  const bulges: Record<string, number> = {};
  for (const key of Object.keys(curves).map(Number).sort((a, b) => a - b)) bulges[String(key)] = curves[key];
  return {
    version: 1,
    kind: shape.kind,
    params,
    ...(shape.kind === "custom" ? { points: (shape.points ?? []).map(([x, y]) => ({ x, y })) } : {}),
    ...(shape.kind === "custom" && Object.keys(bulges).length ? { bulges } : {}),
    radii,
    banded: [...shape.banded],
    // (What it is, and a cabinet's own — only when it has them: a shape without stores just as it always did.)
    ...(shape.base ? { base: { partType: String(shape.base.partType ?? ""), category: String(shape.base.category ?? "").trim().toLowerCase() } } : {}),
    ...(shape.cabinet ? { cabinet: cabinetForStorage(shape.cabinet) } : {}),
  };
}

const CABINET_EDGE_ROLES: CabinetEdgeRole[] = ["back", "end", "doors"];
const isCabinetEdgeRole = (value: unknown): value is CabinetEdgeRole => CABINET_EDGE_ROLES.includes(value as CabinetEdgeRole);

// A cabinet as stored: its roles and through backs as maps by index (Firestore: no arrays of arrays), in order.
function cabinetForStorage(cabinet: CutlistShapeCabinet): Record<string, unknown> {
  const height = Number(cabinet.height);
  const out: Record<string, unknown> = { height: Number.isFinite(height) && height > 0 ? height : DEFAULT_CABINET_HEIGHT };
  const roles: Record<string, CabinetEdgeRole> = {};
  for (const key of Object.keys(cabinet.roles ?? {}).map(Number).filter(Number.isInteger).sort((a, b) => a - b)) {
    const role = cabinet.roles?.[key];
    if (isCabinetEdgeRole(role)) roles[String(key)] = role;
  }
  if (Object.keys(roles).length) out.roles = roles;
  const through: Record<string, boolean> = {};
  for (const key of Object.keys(cabinet.throughBacks ?? {}).map(Number).filter(Number.isInteger).sort((a, b) => a - b)) {
    if (cabinet.throughBacks?.[key] === true) through[String(key)] = true;
  }
  if (Object.keys(through).length) out.throughBacks = through;
  for (const key of ["fixedShelves", "adjustableShelves"] as const) {
    const count = Number(cabinet[key]);
    if (cabinet[key] !== undefined && Number.isFinite(count) && count >= 0) out[key] = Math.round(count);
  }
  return out;
}

// What a stored shape says it is (undefined: nothing — a flat piece, as before there was this).
function readShapeBase(raw: unknown): CutlistShapeBase | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const item = raw as Record<string, unknown>;
  const partType = typeof item.partType === "string" ? item.partType : "";
  const category = typeof item.category === "string" ? item.category.trim().toLowerCase() : "";
  return partType || category ? { partType, category } : undefined;
}

// A stored cabinet, kept to what makes sense for an outline of `count` edges.
function readShapeCabinet(raw: unknown, count: number): CutlistShapeCabinet | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const item = raw as Record<string, unknown>;
  const height = Number(item.height);
  const out: CutlistShapeCabinet = { height: Number.isFinite(height) && height > 0 ? height : DEFAULT_CABINET_HEIGHT };
  const inRange = (key: string) => {
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < count ? index : null;
  };
  const rawRoles = item.roles && typeof item.roles === "object" ? (item.roles as Record<string, unknown>) : {};
  const roles: Record<number, CabinetEdgeRole> = {};
  for (const [key, value] of Object.entries(rawRoles)) {
    const index = inRange(key);
    if (index !== null && isCabinetEdgeRole(value)) roles[index] = value;
  }
  if (Object.keys(roles).length) out.roles = roles;
  const rawThrough = item.throughBacks && typeof item.throughBacks === "object" ? (item.throughBacks as Record<string, unknown>) : {};
  const through: Record<number, boolean> = {};
  for (const [key, value] of Object.entries(rawThrough)) {
    const index = inRange(key);
    if (index !== null && value === true) through[index] = true;
  }
  if (Object.keys(through).length) out.throughBacks = through;
  for (const key of ["fixedShelves", "adjustableShelves"] as const) {
    const n = Number(item[key]);
    if (item[key] !== undefined && item[key] !== null && Number.isFinite(n) && n >= 0) out[key] = Math.round(n);
  }
  return out;
}

// Anything that might be a shape (as stored, or as kept here) as one — undefined if it isn't one that can be cut.
export function normalizeCutlistShape(raw: unknown): CutlistShape | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const item = raw as Record<string, unknown>;
  const kind = item.kind;
  if (kind !== "custom" && !isTemplateShapeKind(kind)) return undefined;
  const finite = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  let params: Record<string, number> = {};
  let points: ShapePoint[] | undefined;
  if (kind === "custom") {
    const list = Array.isArray(item.points) ? item.points : [];
    points = [];
    for (const entry of list) {
      const pair = Array.isArray(entry) ? entry : entry && typeof entry === "object" ? [(entry as Record<string, unknown>).x, (entry as Record<string, unknown>).y] : null;
      const x = pair ? finite(pair[0]) : null;
      const y = pair ? finite(pair[1]) : null;
      if (x !== null && y !== null) points.push([x, y]);
    }
    if (points.length < 3) return undefined;
  } else {
    const rawParams = item.params && typeof item.params === "object" ? (item.params as Record<string, unknown>) : {};
    const read: Record<string, number> = {};
    for (const [key, value] of Object.entries(rawParams)) {
      const n = finite(value);
      if (n !== null) read[key] = n;
    }
    params = clampTemplateParams(kind, read);
  }
  const shape: CutlistShape = { version: 1, kind, params, ...(points ? { points } : {}), radii: {}, banded: [] };
  const count = shapeVertices(shape).length;
  const radii: Record<number, number> = {};
  const rawRadii = item.radii && typeof item.radii === "object" ? (item.radii as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(rawRadii)) {
    const index = Number(key);
    const r = finite(value);
    if (Number.isInteger(index) && index >= 0 && index < count && r !== null && r >= 0) radii[index] = r;
  }
  const banded = Array.from(
    new Set((Array.isArray(item.banded) ? item.banded : []).map(Number).filter((edge) => Number.isInteger(edge) && edge >= 0 && edge < count)),
  ).sort((a, b) => a - b);
  // A custom outline's curves (none stored — a shape from before there were any: every segment straight).
  const rawBulges = kind === "custom" && item.bulges && typeof item.bulges === "object" && !Array.isArray(item.bulges) ? (item.bulges as Record<string, unknown>) : {};
  const bulges = shapeBulges({ ...shape, bulges: Object.fromEntries(Object.entries(rawBulges).map(([key, value]) => [key, finite(value) ?? 0])) });
  // What it is, and a cabinet's own (neither stored — a shape from before them: a flat piece, unchanged).
  const base = readShapeBase(item.base);
  const cabinet = readShapeCabinet(item.cabinet, count);
  return { ...shape, ...(Object.keys(bulges).length ? { bulges } : {}), radii, banded, ...(base ? { base } : {}), ...(cabinet ? { cabinet } : {}) };
}
