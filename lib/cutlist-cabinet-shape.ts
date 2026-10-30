// A custom cabinet: a Custom part type's piece that says it's one of the company's Cabinetry part types
// (isCabinetShape, lib/cutlist-shape.ts). Its drawing is its top view — its footprint — and it has a height. This works
// out what it's made of, by the workshop's own rules (t: the cabinet's board thickness — always given, never assumed):
//
//  - Each edge of the outline is a Back, an End, or open to the Doors (its role). By default the doors are the
//    inside-corner area: every edge at an inside corner (or curving in), and the rest of the run each is in (edges joined
//    through a rounded corner or a smooth join — the runs banding goes by). The ends are the edges either side of the
//    doors that aren't doors themselves (the short edges at each arm's end). Everything else is a back. With no inside
//    corner at all, the doors are its front: a curved edge if it has one, else the edge facing down the drawing (then
//    right). Any edge can be set otherwise; a doors edge's role is its whole run's.
//  - Ends: the cabinet's height × the edge's full length (the full depth). One each.
//  - Backs: the height × the edge's length, less t for each end or back it butts into at its two ends. Where two backs
//    meet, one runs through and the other is t shorter: the one coming into the corner (in the outline's order) runs
//    through, unless the corner's throughBacks says the one going out of it does.
//    (At an inside corner nothing butts — the panels don't reach each other there: the back that runs through is t
//    longer instead, to close the corner, and nothing's taken off the other. Where two edges meet in a straight line
//    they just meet end to end: nothing either way.)
//  - Top and bottom: the drawing with every back and end edge moved in by t; the doors edges, curves and all, as drawn.
//    A fixed shelf is the same shape. (As many fixed shelves as the cabinet says — none unless set.)
//  - Adjustable shelf: every back and end edge moved in by t + 1, and the doors run moved back 10 as a group. (One
//    unless set.)
//  - The shaped parts (top, bottom, shelves) are edge banded along their doors edges.
//
// Moving edges in (offsetShapeOutline): each straight edge's line moved in square to itself, and each curved segment's
// circle by the same (concentric — its radius shrinks if it bows out, grows if it bows in), then each meets its
// neighbours again. A rounded corner between two edges moved the same: an inside one's radius grows by that, an outside
// one's shrinks (to square at the least). Between two moved by different amounts, it's square, where they meet. An edge
// the others close over (too short for how far they moved) is dropped and its neighbours meet instead.
//
// Pure, no React — components/cutlist-shape-editor.tsx sets it up, components/cutlist-cabinet-3d.tsx shows the model.

import {
  DEFAULT_CABINET_HEIGHT,
  SMOOTH_JOIN_RADIANS,
  clampTemplateParams,
  customOutlineSelfIntersects,
  distanceBetween,
  formatShapeMetres,
  formatShapeMm,
  isTemplateShapeKind,
  normalizeCustomShape,
  sampleShapeOutline,
  segmentTangents,
  shapeChainPoints,
  shapeGeometry,
  shapeOuterSize,
  shapeVertices,
  signedPolygonArea,
  type CabinetEdgeRole,
  type CutlistShape,
  type CutlistShapeCabinet,
  type CutlistShapeTemplateKind,
  type ShapeChain,
  type ShapeEdge,
  type ShapeGeometry,
  type ShapePoint,
} from "@/lib/cutlist-shape";
import { paintShapeDrawingOps, shapeDrawingOps, shapeDrawingOpsToSvg, type ShapeDrawing, type ShapeDrawingOp, type ShapeDrawingOptions } from "@/lib/cutlist-shape-render";

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
const midpoint = (a: ShapePoint, b: ShapePoint): ShapePoint => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const TWO_PI = Math.PI * 2;
const wrapAngle = (value: number) => ((value % TWO_PI) + TWO_PI) % TWO_PI;
// Sizes to a thousandth of a mm, radii and bulges to a millionth — the float noise off them.
const roundFine = (value: number) => Math.round(value * 1000) / 1000;
const roundMicro = (value: number) => Math.round(value * 1e6) / 1e6;

// ---- What's set and what's assumed.

export const CABINET_EDGE_ROLES: CabinetEdgeRole[] = ["doors", "back", "end"];
export const CABINET_EDGE_ROLE_LABELS: Record<CabinetEdgeRole, string> = { doors: "Doors", back: "Back", end: "End" };
// Each role's colour on the drawing (readable on light and dark).
export const CABINET_EDGE_ROLE_COLORS: Record<CabinetEdgeRole, string> = { doors: "#2563EB", back: "#8B5CF6", end: "#10B981" };
export const DEFAULT_FIXED_SHELVES = 0;
export const DEFAULT_ADJUSTABLE_SHELVES = 1;
// An adjustable shelf: how much more than t its back and end edges come in (room to tip it in), and how far its doors
// edges go back.
export const ADJUSTABLE_SHELF_CLEARANCE_MM = 1;
export const ADJUSTABLE_SHELF_SETBACK_MM = 10;

const isRole = (value: unknown): value is CabinetEdgeRole => value === "back" || value === "end" || value === "doors";

export type CabinetSettings = { height: number; fixedShelves: number; adjustableShelves: number };
// A cabinet's height and shelf counts, what's not set at its default (720, no fixed shelves, one adjustable).
export function cabinetSettings(shape: CutlistShape): CabinetSettings {
  const cabinet = shape.cabinet;
  const height = Number(cabinet?.height);
  const count = (value: unknown, fallback: number) => {
    const n = Number(value);
    return value !== undefined && value !== null && Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
  };
  return {
    height: Number.isFinite(height) && height > 0 ? height : DEFAULT_CABINET_HEIGHT,
    fixedShelves: count(cabinet?.fixedShelves, DEFAULT_FIXED_SHELVES),
    adjustableShelves: count(cabinet?.adjustableShelves, DEFAULT_ADJUSTABLE_SHELVES),
  };
}

// The shape with its cabinet changed (a cabinet at the default height started, if it had none).
export function withCabinetSettings(shape: CutlistShape, patch: Partial<CutlistShapeCabinet>): CutlistShape {
  const current: CutlistShapeCabinet = shape.cabinet ?? { height: DEFAULT_CABINET_HEIGHT };
  const next: CutlistShapeCabinet = { ...current, ...patch };
  // (Nothing kept that's empty.)
  if (next.roles && !Object.keys(next.roles).length) delete next.roles;
  if (next.throughBacks && !Object.keys(next.throughBacks).length) delete next.throughBacks;
  return { ...shape, cabinet: next };
}

// ---- Inside corners and curves.

// A corner the material wraps round (concave). Beside a curve it's the way its curve and its other edge actually turn
// there; a smooth join is neither.
function cornerIsInside(geometry: ShapeGeometry, index: number): boolean {
  const corner = geometry.corners[index];
  if (!corner || corner.smooth) return false;
  if (!corner.nextToCurve) return corner.inside;
  const n = geometry.edges.length;
  const before = geometry.edges[(index - 1 + n) % n];
  const after = geometry.edges[index];
  const incoming = segmentTangents(before.startVertex, before.endVertex, before.curve).end;
  const outgoing = segmentTangents(after.startVertex, after.endVertex, after.curve).start;
  return cross(incoming, outgoing) * geometry.orientation < 0;
}

// A curved segment that bows out (the material inside its circle) — or, not, bows in.
function curveBowsOut(edge: ShapeEdge): boolean {
  const curve = edge.curve;
  return curve !== null && dot(sub(curve.mid, curve.center), edge.normal) > 0;
}

// ---- Roles.

// What each edge is when nothing's been set (see the top of the file).
export function defaultCabinetEdgeRoles(shape: CutlistShape): CabinetEdgeRole[] {
  const geometry = shapeGeometry(shape);
  return geometry.valid ? defaultRolesFor(geometry) : [];
}

function defaultRolesFor(geometry: ShapeGeometry): CabinetEdgeRole[] {
  const n = geometry.edges.length;
  const insideArea = new Array<boolean>(n).fill(false);
  for (const corner of geometry.corners) {
    if (!cornerIsInside(geometry, corner.index)) continue;
    insideArea[(corner.index - 1 + n) % n] = true;
    insideArea[corner.index] = true;
  }
  for (const edge of geometry.edges) if (edge.curve && !curveBowsOut(edge)) insideArea[edge.index] = true;
  let doorRuns = geometry.runs.filter((run) => run.edges.some((edge) => insideArea[edge]));
  if (!doorRuns.length) {
    // No inside corner: its front — a curved edge if it has one, else the edge facing down the drawing most (then
    // right: an angled corner's cut), the longest of those.
    const score = (edge: ShapeEdge) => edge.normal[1] + 0.99 * edge.normal[0];
    const pick = (edges: ShapeEdge[]) =>
      edges.reduce<ShapeEdge | null>((best, edge) => {
        if (!best) return edge;
        const diff = score(edge) - score(best);
        return diff > 1e-9 || (Math.abs(diff) <= 1e-9 && edge.length > best.length) ? edge : best;
      }, null);
    const front = pick(geometry.edges.filter((edge) => edge.curve)) ?? pick(geometry.edges);
    if (front) doorRuns = geometry.runs.filter((run) => run.edges.includes(front.index));
  }
  const roles = new Array<CabinetEdgeRole>(n).fill("back");
  for (const run of doorRuns) for (const edge of run.edges) roles[edge] = "doors";
  for (const run of doorRuns) {
    // (Doors the whole way round: nothing either side.)
    if (run.corners.length >= n) continue;
    const before = (run.edges[0] - 1 + n) % n;
    const after = (run.edges[run.edges.length - 1] + 1) % n;
    for (const edge of [before, after]) if (roles[edge] !== "doors") roles[edge] = "end";
  }
  return roles;
}

// What each edge is: as set (shape.cabinet.roles), else its default — a doors edge's whole run doors.
export function cabinetEdgeRoles(shape: CutlistShape): CabinetEdgeRole[] {
  const geometry = shapeGeometry(shape);
  return geometry.valid ? rolesFor(shape, geometry) : [];
}

function rolesFor(shape: CutlistShape, geometry: ShapeGeometry): CabinetEdgeRole[] {
  const set = shape.cabinet?.roles ?? {};
  const roles = defaultRolesFor(geometry).map((role, i) => (isRole(set[i]) ? set[i] : role));
  for (const run of geometry.runs) {
    if (run.edges.some((edge) => roles[edge] === "doors")) for (const edge of run.edges) roles[edge] = "doors";
  }
  return roles;
}

// An edge made `role` — every edge's role kept from then on (shape.cabinet.roles, all of them). Doors (to or from):
// its whole run.
export function setCabinetEdgeRole(shape: CutlistShape, edgeIndex: number, role: CabinetEdgeRole): CutlistShape {
  const geometry = shapeGeometry(shape);
  if (!geometry.valid || !isRole(role) || !Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= geometry.edges.length) return shape;
  const roles = rolesFor(shape, geometry);
  const run = geometry.runs.find((candidate) => candidate.edges.includes(edgeIndex));
  const group = run && (role === "doors" || roles[edgeIndex] === "doors") ? run.edges : [edgeIndex];
  for (const edge of group) roles[edge] = role;
  const stored: Record<number, CabinetEdgeRole> = {};
  roles.forEach((value, i) => (stored[i] = value));
  return withCabinetSettings(shape, { roles: stored });
}

// A tap on an edge: Doors → Back → End → Doors.
export function cycleCabinetEdgeRole(shape: CutlistShape, edgeIndex: number): CutlistShape {
  const current = cabinetEdgeRoles(shape)[edgeIndex];
  if (!current) return shape;
  return setCabinetEdgeRole(shape, edgeIndex, CABINET_EDGE_ROLES[(CABINET_EDGE_ROLES.indexOf(current) + 1) % CABINET_EDGE_ROLES.length]);
}

// Every edge back to its default, every back-to-back corner as it starts.
export function resetCabinetEdgeRoles(shape: CutlistShape): CutlistShape {
  if (!shape.cabinet) return shape;
  return withCabinetSettings(shape, { roles: {}, throughBacks: {} });
}

// ---- Where two backs meet.

export type CabinetBackCorner = {
  corner: number;
  // The back coming into the corner (edge corner − 1) and the one going out of it (edge corner).
  incoming: number;
  outgoing: number;
  // Which of the two runs through (the other's t shorter — at an inside corner, it's t longer instead).
  through: number;
  flipped: boolean;
  inside: boolean;
};

export function cabinetBackCorners(shape: CutlistShape): CabinetBackCorner[] {
  const geometry = shapeGeometry(shape);
  return geometry.valid ? backCornersFor(shape, geometry, rolesFor(shape, geometry)) : [];
}

function backCornersFor(shape: CutlistShape, geometry: ShapeGeometry, roles: CabinetEdgeRole[]): CabinetBackCorner[] {
  const n = geometry.edges.length;
  const flips = shape.cabinet?.throughBacks ?? {};
  const out: CabinetBackCorner[] = [];
  for (const corner of geometry.corners) {
    // (Meeting in a straight line, they only meet end to end.)
    if (corner.smooth) continue;
    const incoming = (corner.index - 1 + n) % n;
    const outgoing = corner.index;
    if (incoming === outgoing || roles[incoming] !== "back" || roles[outgoing] !== "back") continue;
    const flipped = flips[corner.index] === true;
    out.push({ corner: corner.index, incoming, outgoing, through: flipped ? outgoing : incoming, flipped, inside: cornerIsInside(geometry, corner.index) });
  }
  return out;
}

// Which of the two backs at a corner runs through, swapped.
export function toggleCabinetThroughBack(shape: CutlistShape, corner: number): CutlistShape {
  if (!Number.isInteger(corner) || corner < 0) return shape;
  const flips: Record<number, boolean> = { ...(shape.cabinet?.throughBacks ?? {}) };
  if (flips[corner]) delete flips[corner];
  else flips[corner] = true;
  return withCabinetSettings(shape, { throughBacks: flips });
}

// ---- Each role as a line on the drawing: edges one after another in the same role, through the corners joining them
// (rounded or smooth) — a closed one the whole way round. (As shapeBandedChains, by role.)
export function cabinetRoleChains(geometry: ShapeGeometry, roles: CabinetEdgeRole[]): Array<{ role: CabinetEdgeRole; chain: ShapeChain }> {
  const n = geometry.edges.length;
  if (!geometry.valid || !n || roles.length !== n) return [];
  const joins = geometry.corners.map((corner) => corner.radius > 0 || corner.smooth);
  const carriesOn = (i: number) => joins[i] && roles[i] === roles[(i - 1 + n) % n];
  if (roles.every((_, i) => carriesOn(i))) return [{ role: roles[0], chain: { edges: roles.map((_, i) => i), closed: true } }];
  const out: Array<{ role: CabinetEdgeRole; chain: ShapeChain }> = [];
  for (let i = 0; i < n; i += 1) {
    if (carriesOn(i)) continue;
    const edges = [i];
    for (let j = (i + 1) % n; j !== i && carriesOn(j); j = (j + 1) % n) edges.push(j);
    out.push({ role: roles[i], chain: { edges, closed: false } });
  }
  return out;
}

// ---- Moving edges in.

// Each edge's line or circle, moved in by `d` (its own: −d moves it out).
type Carrier =
  | { kind: "line"; source: number; d: number; p: ShapePoint; u: ShapePoint }
  | { kind: "arc"; source: number; d: number; c: ShapePoint; r: number; dir: 1 | -1; span: number };

// Where `point` is nearest on a carrier.
function nearestOn(carrier: Carrier, point: ShapePoint): ShapePoint {
  if (carrier.kind === "line") return add(carrier.p, mul(carrier.u, dot(sub(point, carrier.p), carrier.u)));
  const towards = unit(sub(point, carrier.c));
  return add(carrier.c, mul(len(towards) ? towards : [1, 0], carrier.r));
}

// Where carrier `a` (coming in) meets `b` (going on): of two crossings (a curve's), the one nearest `hint` (about where
// they meet, moved) — one `prefer` likes (inside the drawing, edges moved in) over one it doesn't. Not meeting at all
// (a curve that flowed into a line, the two moved by different amounts): a step — `a`'s end and `b`'s start, both as
// near `hint` as they go, joined by a short straight edge.
const MEET_SLACK_MM = 1e-6;
function meet(a: Carrier, b: Carrier, hint: ShapePoint, prefer?: (p: ShapePoint) => boolean): ShapePoint[] {
  const nearest = (candidates: ShapePoint[]) => {
    const liked = prefer ? candidates.filter(prefer) : [];
    const pool = liked.length ? liked : candidates;
    return pool.reduce((best, p) => (distanceBetween(p, hint) < distanceBetween(best, hint) ? p : best), pool[0]);
  };
  const step = (): ShapePoint[] => {
    const from = nearestOn(a, hint);
    const to = nearestOn(b, hint);
    return distanceBetween(from, to) <= MEET_SLACK_MM ? [midpoint(from, to)] : [from, to];
  };
  if (a.kind === "line" && b.kind === "line") {
    const denom = cross(a.u, b.u);
    // (Parallel — in line with each other: where they meet is the same point on both, unless they moved apart. Near
    // enough in line — within a smooth join's 2° — and moved by different amounts, they'd only meet far off: a step.)
    if (Math.abs(denom) < 1e-9) return step();
    if (Math.abs(denom) < Math.sin(SMOOTH_JOIN_RADIANS) && dot(a.u, b.u) > 0 && Math.abs(a.d - b.d) > 1e-9) return step();
    const s = cross(sub(b.p, a.p), b.u) / denom;
    return [add(a.p, mul(a.u, s))];
  }
  if (a.kind === "arc" && b.kind === "arc") {
    const between = sub(b.c, a.c);
    const apart = len(between);
    if (apart < 1e-9) return step();
    const x = (a.r * a.r - b.r * b.r + apart * apart) / (2 * apart);
    const h2 = a.r * a.r - x * x;
    if (h2 < 0 && Math.abs(x) - a.r > MEET_SLACK_MM) return step();
    const e = mul(between, 1 / apart);
    const base = add(a.c, mul(e, x));
    const h = Math.sqrt(Math.max(0, h2));
    const across: ShapePoint = [-e[1], e[0]];
    return [nearest([add(base, mul(across, h)), sub(base, mul(across, h))])];
  }
  const line = (a.kind === "line" ? a : b) as Extract<Carrier, { kind: "line" }>;
  const arc = (a.kind === "arc" ? a : b) as Extract<Carrier, { kind: "arc" }>;
  const w = sub(line.p, arc.c);
  const half = dot(line.u, w);
  const disc = half * half - (dot(w, w) - arc.r * arc.r);
  // (A line that touched the curve, both moved the same, still touches — near enough, as numbers go.)
  if (disc < 0 && Math.abs(cross(line.u, w)) - arc.r > MEET_SLACK_MM) return step();
  const root = Math.sqrt(Math.max(0, disc));
  return [nearest([add(line.p, mul(line.u, -half + root)), add(line.p, mul(line.u, -half - root))])];
}

// How long a carrier's stretch from `start` to `end` is, along it the way it runs — 0 or less: it's closed up, or
// turned back on itself (its neighbours have crossed over it).
function stretchAlong(carrier: Carrier, start: ShapePoint, end: ShapePoint): number {
  if (carrier.kind === "line") return dot(sub(end, start), carrier.u);
  const a0 = Math.atan2(start[1] - carrier.c[1], start[0] - carrier.c[0]);
  const a1 = Math.atan2(end[1] - carrier.c[1], end[0] - carrier.c[0]);
  const turned = carrier.dir > 0 ? wrapAngle(a1 - a0) : wrapAngle(a0 - a1);
  // (Round nearly the whole way — further than it went to start with, past halfway to a full turn: it went backwards.)
  if (turned > carrier.span + (TWO_PI - carrier.span) / 2) return -(TWO_PI - turned) * carrier.r;
  return turned * carrier.r;
}

// A curve's bulge, round its carrier's circle from `start` to `end` the way it runs (DXF's, as the shape has them).
function bulgeAlong(carrier: Extract<Carrier, { kind: "arc" }>, start: ShapePoint, end: ShapePoint): number {
  const a0 = Math.atan2(start[1] - carrier.c[1], start[0] - carrier.c[0]);
  const a1 = Math.atan2(end[1] - carrier.c[1], end[0] - carrier.c[0]);
  const turned = carrier.dir > 0 ? wrapAngle(a1 - a0) : wrapAngle(a0 - a1);
  return -Math.tan((carrier.dir * turned) / 4);
}

// An outline with its edges moved, in the drawing's own place (not moved to 0, 0): its corner points, its curves and
// its corners' radii (every corner's, by corner), and the drawn edge each of its edges came from (null: a short step
// joining two that no longer meet — see meet).
export type OffsetOutline = {
  points: ShapePoint[];
  bulges: Record<number, number>;
  radii: Record<number, number>;
  sourceEdges: Array<number | null>;
};

// The shape's outline with each edge moved in by its own distance (`distances`, by edge — negative: out). null if
// there's nothing left of it, or what's left would cross itself.
export function offsetShapeOutline(shape: CutlistShape, distances: ArrayLike<number> | ((edge: number) => number)): OffsetOutline | null {
  const geometry = shapeGeometry(shape);
  if (!geometry.valid) return null;
  const n = geometry.edges.length;
  const distanceOf = (edge: number) => {
    const value = Number(typeof distances === "function" ? distances(edge) : distances[edge]);
    return Number.isFinite(value) ? value : 0;
  };

  // Each edge's carrier, moved; the hint where it starts (its first corner). A curve shrunk to nothing, or a
  // zero-length edge, isn't one — the next one's hint is where it was.
  const list: Array<{ carrier: Carrier; hint: ShapePoint }> = [];
  let pendingHint: ShapePoint | null = null;
  for (const edge of geometry.edges) {
    const d = distanceOf(edge.index);
    let carrier: Carrier | null = null;
    if (edge.curve) {
      const r = edge.curve.radius + (curveBowsOut(edge) ? -d : d);
      if (r > 1e-6) {
        carrier = { kind: "arc", source: edge.index, d, c: edge.curve.center, r, dir: edge.curve.sweep > 0 ? 1 : -1, span: Math.abs(edge.curve.sweep) };
      }
    } else if (edge.vertexLength > 1e-9) {
      carrier = { kind: "line", source: edge.index, d, p: add(edge.startVertex, mul(edge.normal, -d)), u: unit(sub(edge.endVertex, edge.startVertex)) };
    }
    if (!carrier) {
      pendingHint ??= midpoint(edge.startVertex, edge.endVertex);
      continue;
    }
    list.push({ carrier, hint: pendingHint ?? edge.startVertex });
    pendingHint = null;
  }
  if (pendingHint && list.length) list[0] = { ...list[0], hint: pendingHint };
  // (Where each corner went, about: in from it — along the middle of its corner — as far as its edges moved in.)
  for (let k = 0; k < list.length; k += 1) {
    const item = list[k];
    const before = list[(k - 1 + list.length) % list.length].carrier;
    const corner = geometry.corners[item.carrier.source];
    if (!corner || (before.source + 1) % n !== item.carrier.source) continue;
    const reach = Math.max(0, before.d, item.carrier.d);
    if (reach > 0) list[k] = { ...item, hint: sub(corner.point, mul(corner.outward, reach)) };
  }
  // Edges all moved in: a corner's new place is inside the drawing (as cut, or with its corners square — see
  // drawingRegion).
  const region = geometry.edges.every((edge) => distanceOf(edge.index) >= 0) ? drawingRegion(shape, geometry) : null;
  const prefer = region ? region.contains : undefined;

  // Each meets the next; one that's closed up or turned back on itself (the worst first) is dropped, and its
  // neighbours meet again — till none is.
  for (let guard = 0; guard <= n + 2; guard += 1) {
    const m = list.length;
    if (m < 2 || (m < 3 && list.every((item) => item.carrier.kind === "line"))) return null;
    const joins = list.map((item, k) => meet(list[(k - 1 + m) % m].carrier, item.carrier, item.hint, prefer));
    let worst = -1;
    let worstAlong = 0;
    for (let k = 0; k < m; k += 1) {
      const start = joins[k][joins[k].length - 1];
      const end = joins[(k + 1) % m][0];
      const along = stretchAlong(list[k].carrier, start, end);
      if (along <= 1e-6 && (worst < 0 || along < worstAlong)) {
        worst = k;
        worstAlong = along;
      }
    }
    if (worst >= 0) {
      const start = joins[worst][joins[worst].length - 1];
      const end = joins[(worst + 1) % m][0];
      const next = (worst + 1) % m;
      list[next] = { ...list[next], hint: midpoint(start, end) };
      list.splice(worst, 1);
      continue;
    }

    // ---- Settled: its points, curves, radii and where each edge came from.
    const points: ShapePoint[] = [];
    const radii: Record<number, number> = {};
    const sourceEdges: Array<number | null> = [];
    const carriers: Carrier[] = [];
    list.forEach((item, k) => {
      const join = joins[k];
      const before = list[(k - 1 + m) % m].carrier;
      if (join.length === 2) {
        radii[points.length] = 0;
        points.push(join[0]);
        sourceEdges.push(null);
        carriers.push(before);
      }
      radii[points.length] = join.length === 2 ? 0 : movedCornerRadius(geometry, before, item.carrier);
      points.push(join[join.length - 1]);
      sourceEdges.push(item.carrier.source);
      carriers.push(item.carrier);
    });
    const bulges: Record<number, number> = {};
    points.forEach((point, j) => {
      const carrier = carriers[j];
      if (sourceEdges[j] === null || carrier.kind !== "arc") return;
      const bulge = roundMicro(bulgeAlong(carrier, point, points[(j + 1) % points.length]));
      if (Math.abs(bulge) > 1e-6) bulges[j] = bulge;
    });
    // (No good if it crosses itself — a narrow bit pinched shut — or it's turned inside out.)
    if (points.length < 3 && !Object.keys(bulges).length) return null;
    if (customOutlineSelfIntersects(points, bulges, true)) return null;
    const moved = shapeGeometry({ version: 1, kind: "custom", params: {}, points, bulges, radii, banded: [] });
    if (!moved.valid || moved.orientation !== geometry.orientation) return null;
    // (Every edge moved in, none out: it has to be inside the drawing — nearly-in-line edges moved by very different
    // amounts can meet far off, and what's left of them isn't.)
    if (region && !sampleShapeOutline(moved, REGION_SAMPLING).every(({ point }) => region.contains(point))) return null;
    return { points, bulges, radii, sourceEdges };
  }
  return null;
}

// The drawing as somewhere a point can be in: inside its outline as cut, or as it'd be with its corners square, or on
// either (to a tenth). (An outside corner left square where its edges moved by different amounts reaches into the
// rounding it had; an inside one's rounding grown reaches into the square corner.)
const REGION_SAMPLING = { stepRadians: Math.PI / 36, toleranceMm: 0.02 };
function drawingRegion(shape: CutlistShape, geometry: ShapeGeometry): { contains: (p: ShapePoint) => boolean } {
  const square = shapeGeometry({ ...shape, radii: Object.fromEntries(geometry.corners.map((corner) => [corner.index, 0])) });
  const rings = [geometry, square]
    .filter((outline) => outline.valid)
    .map((outline) => sampleShapeOutline(outline, REGION_SAMPLING).map((sample) => sample.point))
    .filter((ring) => ring.length >= 3);
  const tolerance = 0.1;
  const nearRing = (ring: ShapePoint[], p: ShapePoint) => {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const ab = sub(ring[(i + 1) % ring.length], a);
      const l2 = dot(ab, ab);
      const k = l2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0;
      if (distanceBetween(p, add(a, mul(ab, k))) <= tolerance) return true;
    }
    return false;
  };
  const insideRing = (ring: ShapePoint[], p: ShapePoint) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i];
      const b = ring[j];
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  return { contains: (p) => rings.some((ring) => insideRing(ring, p) || nearRing(ring, p)) };
}

// A rounded corner between two straight edges, both moved the same `d`: an inside one's radius r + d, an outside one's
// r − d (square at the least). Anything else — moved by different amounts, beside a curve, two edges that only meet
// now one between them has gone — square.
function movedCornerRadius(geometry: ShapeGeometry, before: Carrier, after: Carrier): number {
  const n = geometry.edges.length;
  if (before.kind !== "line" || after.kind !== "line" || (before.source + 1) % n !== after.source) return 0;
  const corner = geometry.corners[after.source];
  if (!corner || !(corner.radius > 0) || Math.abs(before.d - after.d) > 1e-9) return 0;
  return roundMicro(corner.inside ? corner.radius + after.d : Math.max(0, corner.radius - after.d));
}

// The outline moved, as a shape of its own — at 0, 0, banded on `bandedSources` (the drawn edges whose edges are), and
// where its 0, 0 was on the drawing. A template still the same template (its sizes all in order) stays one: an L moved
// in is still an L, its sizes the new ones; anything else is a Custom outline.
export function offsetOutlineShape(
  source: CutlistShape,
  outline: OffsetOutline,
  bandedSources: Iterable<number> = [],
): { shape: CutlistShape; origin: ShapePoint } {
  const bandedSet = new Set(bandedSources);
  const banded = outline.sourceEdges.flatMap((sourceEdge, j) => (sourceEdge !== null && bandedSet.has(sourceEdge) ? [j] : []));
  // Its radii: every one that isn't square, and every inside corner's (square or not — an inside corner's default isn't).
  const probe = shapeGeometry({ version: 1, kind: "custom", params: {}, points: outline.points, bulges: outline.bulges, radii: outline.radii, banded: [] });
  const radii: Record<number, number> = {};
  for (const [key, value] of Object.entries(outline.radii)) {
    const index = Number(key);
    if (value > 0 || probe.corners[index]?.inside) radii[index] = value;
  }
  const asTemplate = isTemplateShapeKind(source.kind) ? templateFromOutline(source.kind, outline) : null;
  if (asTemplate) return { shape: { version: 1, kind: source.kind, params: asTemplate.params, radii, banded }, origin: asTemplate.origin };
  const custom: CutlistShape = { version: 1, kind: "custom", params: {}, points: outline.points.map((p) => [p[0], p[1]] as ShapePoint), radii, banded };
  if (Object.keys(outline.bulges).length) custom.bulges = { ...outline.bulges };
  const { shape, shift } = normalizeCustomShape(custom);
  return { shape, origin: shift };
}

// A template's sizes from its corner points — only if they're exactly that template's (nothing dropped or added, every
// size in range and to a tenth).
function templateFromOutline(kind: CutlistShapeTemplateKind, outline: OffsetOutline): { params: Record<string, number>; origin: ShapePoint } | null {
  const raw = outline.points;
  if (Object.keys(outline.bulges).length || outline.sourceEdges.some((sourceEdge, j) => sourceEdge !== j)) return null;
  const o = raw[0];
  const q = raw.map((p) => sub(p, o));
  const expected = { rect: 4, L: 6, U: 8, notch: 6, angled: 5 }[kind];
  if (q.length !== expected) return null;
  const params: Record<string, number> =
    kind === "rect"
      ? { W: q[1][0], H: q[2][1] }
      : kind === "L"
        ? { W: q[1][0], H: q[4][1], A: q[2][1], B: q[3][0] }
        : kind === "U"
          ? { W: q[1][0], H: q[2][1], A: q[4][1], B: q[5][0], C: q[1][0] - q[3][0] }
          : kind === "notch"
            ? { W: q[3][0], H: q[4][1], nw: q[3][0] - q[1][0], nh: q[2][1] }
            : { W: q[1][0], H: q[3][1], cx: q[1][0] - q[3][0], cy: q[3][1] - q[2][1] };
  const clamped = clampTemplateParams(kind, params);
  const check = shapeVertices({ version: 1, kind, params: clamped, radii: {}, banded: [] });
  if (check.length !== q.length || check.some((p, i) => distanceBetween(p, q[i]) > 1e-6)) return null;
  return { params: clamped, origin: [roundFine(o[0]), roundFine(o[1])] };
}

// ---- The cabinet worked out.

export type CabinetPartName = "Back" | "End" | "Top" | "Bottom" | "Fixed shelf" | "Adjustable shelf";
export type CabinetPart = {
  // "back:<edge>", "end:<edge>", "top", "bottom", "fixed-shelf", "adjustable-shelf".
  key: string;
  name: CabinetPartName;
  quantity: number;
  // A panel: a plain rectangle. A shape: cut to its own outline (`shape`).
  kind: "panel" | "shape";
  // A panel: Height — the cabinet's — and Width (along its edge). A shaped part: the box round it (Width across the
  // drawing, Height down it — shapeOuterSize).
  width?: number;
  height?: number;
  // A shaped part's outline (at 0, 0), banded along its doors edges.
  shape?: CutlistShape;
  // The drawn outline's edges it stands on — a Back's or End's own edge; a shaped part's, the doors edges it's banded
  // along.
  edges?: number[];
  // A shaped part: where its own 0, 0 sits on the drawing (mm).
  origin?: ShapePoint;
  // Why there isn't one (its edges moved in so far there's nothing left, or it'd cross itself): no shape then.
  problem?: string;
};

export type CabinetOptions = {
  // The cabinet's board thickness (mm) — t.
  thicknessMm: number;
  // Override the cabinet's own (shape.cabinet: 720 high, 0 fixed shelves, 1 adjustable).
  height?: number;
  fixedShelves?: number;
  adjustableShelves?: number;
};

type CabinetWork = {
  geometry: ShapeGeometry;
  roles: CabinetEdgeRole[];
  backCorners: CabinetBackCorner[];
  t: number;
  settings: CabinetSettings;
  // By edge: how much shorter its panel is at its start and its end (− : longer).
  trims: Array<{ start: number; end: number }>;
  // The top / bottom (and fixed shelf), and the adjustable shelf, moved in.
  plate: OffsetOutline | null;
  adjustable: OffsetOutline | null;
};

function workCabinet(shape: CutlistShape, options: CabinetOptions): CabinetWork | null {
  const geometry = shapeGeometry(shape);
  if (!geometry.valid) return null;
  const n = geometry.edges.length;
  const thickness = Number(options.thicknessMm);
  const t = Number.isFinite(thickness) && thickness > 0 ? thickness : 0;
  const own = cabinetSettings(shape);
  const count = (value: unknown, fallback: number) => {
    const v = Number(value);
    return value !== undefined && value !== null && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback;
  };
  const height = Number(options.height);
  const settings: CabinetSettings = {
    height: Number.isFinite(height) && height > 0 ? height : own.height,
    fixedShelves: count(options.fixedShelves, own.fixedShelves),
    adjustableShelves: count(options.adjustableShelves, own.adjustableShelves),
  };
  const roles = rolesFor(shape, geometry);
  const backCorners = backCornersFor(shape, geometry, roles);
  const throughAt = new Map(backCorners.map((corner) => [corner.corner, corner]));

  // How much a back is cut back at corner `c`, where it meets edge `other`.
  const trimAt = (self: number, c: number, other: number): number => {
    const corner = geometry.corners[c];
    if (!corner || corner.smooth || roles[other] === "doors") return 0;
    const inside = cornerIsInside(geometry, c);
    if (roles[other] === "end") return inside ? -t : t;
    const meeting = throughAt.get(c);
    if (!meeting) return 0;
    if (meeting.through === self) return inside ? -t : 0;
    return inside ? 0 : t;
  };
  const trims = geometry.edges.map((edge) =>
    roles[edge.index] !== "back"
      ? { start: 0, end: 0 }
      : { start: trimAt(edge.index, edge.index, (edge.index - 1 + n) % n), end: trimAt(edge.index, (edge.index + 1) % n, (edge.index + 1) % n) },
  );

  const plate = offsetShapeOutline(shape, (edge) => (roles[edge] === "doors" ? 0 : t));
  const adjustable = offsetShapeOutline(shape, (edge) => (roles[edge] === "doors" ? ADJUSTABLE_SHELF_SETBACK_MM : t + ADJUSTABLE_SHELF_CLEARANCE_MM));
  return { geometry, roles, backCorners, t, settings, trims, plate, adjustable };
}

// An edge's full length: corner to corner, or round its curve.
const edgeFullLength = (edge: ShapeEdge) => (edge.curve ? edge.curve.length : edge.vertexLength);

// Everything a custom cabinet's made of (see the top of the file): its backs and ends (in the outline's order), then its
// top, bottom and shelves. Empty if it isn't a shape that can be cut.
export function customCabinetParts(shape: CutlistShape, options: CabinetOptions): CabinetPart[] {
  const work = workCabinet(shape, options);
  if (!work) return [];
  const { geometry, roles, trims, settings, plate, adjustable } = work;
  const parts: CabinetPart[] = [];
  for (const role of ["back", "end"] as const) {
    for (const edge of geometry.edges) {
      if (roles[edge.index] !== role) continue;
      const trim = trims[edge.index];
      const length = Math.max(0, edgeFullLength(edge) - trim.start - trim.end);
      parts.push({
        key: `${role}:${edge.index}`,
        name: role === "back" ? "Back" : "End",
        quantity: 1,
        kind: "panel",
        width: roundFine(length),
        height: roundFine(settings.height),
        edges: [edge.index],
      });
    }
  }
  const doorEdges = roles.flatMap((role, i) => (role === "doors" ? [i] : []));
  const shaped = (key: string, name: CabinetPartName, quantity: number, outline: OffsetOutline | null): CabinetPart => {
    if (!outline) return { key, name, quantity, kind: "shape", edges: doorEdges, problem: "Too small to make" };
    const { shape: partShape, origin } = offsetOutlineShape(shape, outline, doorEdges);
    const size = shapeOuterSize(partShape);
    return { key, name, quantity, kind: "shape", width: size.width, height: size.height, shape: partShape, edges: doorEdges, origin };
  };
  parts.push(shaped("top", "Top", 1, plate));
  parts.push(shaped("bottom", "Bottom", 1, plate));
  if (settings.fixedShelves > 0) parts.push(shaped("fixed-shelf", "Fixed shelf", settings.fixedShelves, plate));
  if (settings.adjustableShelves > 0) parts.push(shaped("adjustable-shelf", "Adjustable shelf", settings.adjustableShelves, adjustable));
  return parts;
}

// ---- The 3D model: each panel a prism — its plan (mm, the drawing's own x and y, y down the page) stood up from z0 to
// z1 (mm, up). The doors (see-through) stand just outside the doors edges.

export type CabinetPrismKind = "back" | "end" | "top" | "bottom" | "fixed-shelf" | "adjustable-shelf" | "door";
export type CabinetPrism = {
  key: string;
  // The part it's one of (customCabinetParts' key; a door: "door:<edge>").
  part: string;
  kind: CabinetPrismKind;
  // Its plan, wound the way the drawing's positive area goes (clockwise on the screen).
  polygon: ShapePoint[];
  z0: number;
  z1: number;
  translucent: boolean;
};
export type CabinetModel = {
  prisms: CabinetPrism[];
  height: number;
  thicknessMm: number;
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
};

// A strip along an edge, `depth` deep into the material (− : out of it), cut back `trimStart` / `trimEnd` at its ends.
function edgeStrip(edge: ShapeEdge, trimStart: number, trimEnd: number, depth: number): ShapePoint[] {
  if (!edge.curve) {
    const length = edge.vertexLength;
    if (!(length - trimStart - trimEnd > 1e-6)) return [];
    const u = unit(sub(edge.endVertex, edge.startVertex));
    const inward = mul(edge.normal, -depth);
    const a = add(edge.startVertex, mul(u, trimStart));
    const b = sub(edge.endVertex, mul(u, trimEnd));
    return [a, b, add(b, inward), add(a, inward)];
  }
  const arc = edge.curve;
  const dir = arc.sweep > 0 ? 1 : -1;
  const a0 = arc.startAngle + (dir * trimStart) / arc.radius;
  const a1 = arc.startAngle + arc.sweep - (dir * trimEnd) / arc.radius;
  if (!((a1 - a0) * dir > 1e-9)) return [];
  const inner = Math.max(0, arc.radius + (curveBowsOut(edge) ? -depth : depth));
  const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 36)));
  const outer: ShapePoint[] = [];
  const innerPoints: ShapePoint[] = [];
  for (let s = 0; s <= steps; s += 1) {
    const theta = a0 + ((a1 - a0) * s) / steps;
    const direction: ShapePoint = [Math.cos(theta), Math.sin(theta)];
    outer.push(add(arc.center, mul(direction, arc.radius)));
    innerPoints.push(add(arc.center, mul(direction, inner)));
  }
  return [...outer, ...innerPoints.reverse()];
}

// A plan as a prism's: no point doubled up, wound clockwise on the screen (positive area).
function prismPolygon(points: ShapePoint[]): ShapePoint[] {
  const out: ShapePoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || distanceBetween(last, p) > 1e-6) out.push([p[0], p[1]]);
  }
  if (out.length > 1 && distanceBetween(out[0], out[out.length - 1]) <= 1e-6) out.pop();
  return signedPolygonArea(out) < 0 ? out.reverse() : out;
}

// An outline moved in, as a plan (its curves sampled).
function outlinePolygon(outline: OffsetOutline): ShapePoint[] {
  const geometry = shapeGeometry({ version: 1, kind: "custom", params: {}, points: outline.points, bulges: outline.bulges, radii: outline.radii, banded: [] });
  return geometry.valid ? prismPolygon(sampleShapeOutline(geometry, { stepRadians: Math.PI / 24, toleranceMm: 0.5 }).map((sample) => sample.point)) : [];
}

export function customCabinetModel(shape: CutlistShape, options: CabinetOptions): CabinetModel {
  const work = workCabinet(shape, options);
  const empty: CabinetModel = { prisms: [], height: 0, thicknessMm: 0, bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 } };
  if (!work) return empty;
  const { geometry, roles, trims, t, settings, plate, adjustable } = work;
  const H = settings.height;
  const prisms: CabinetPrism[] = [];
  const push = (prism: Omit<CabinetPrism, "polygon"> & { polygon: ShapePoint[] }) => {
    const polygon = prismPolygon(prism.polygon);
    if (polygon.length >= 3 && Math.abs(signedPolygonArea(polygon)) > 1e-6 && prism.z1 > prism.z0) prisms.push({ ...prism, polygon });
  };
  // Backs and ends: the full height, t deep, along their edges.
  for (const edge of geometry.edges) {
    const role = roles[edge.index];
    if (role === "doors") continue;
    const trim = trims[edge.index];
    push({ key: `${role}:${edge.index}`, part: `${role}:${edge.index}`, kind: role, polygon: edgeStrip(edge, trim.start, trim.end, t), z0: 0, z1: H, translucent: false });
  }
  // Top and bottom between them; the shelves evenly up the inside.
  const platePlan = plate ? outlinePolygon(plate) : [];
  const shelfPlan = adjustable ? outlinePolygon(adjustable) : [];
  const board = Math.min(t, H / 2);
  push({ key: "bottom", part: "bottom", kind: "bottom", polygon: platePlan, z0: 0, z1: board, translucent: false });
  push({ key: "top", part: "top", kind: "top", polygon: platePlan, z0: H - board, z1: H, translucent: false });
  const shelves: Array<{ kind: "fixed-shelf" | "adjustable-shelf"; plan: ShapePoint[] }> = [
    ...Array.from({ length: settings.fixedShelves }, () => ({ kind: "fixed-shelf" as const, plan: platePlan })),
    ...Array.from({ length: settings.adjustableShelves }, () => ({ kind: "adjustable-shelf" as const, plan: shelfPlan })),
  ];
  const k = shelves.length;
  const gap = Math.max(0, (H - 2 * board - k * board) / (k + 1));
  shelves.forEach((shelf, j) => {
    const z0 = board + (j + 1) * gap + j * board;
    push({ key: `${shelf.kind}#${j + 1}`, part: shelf.kind, kind: shelf.kind, polygon: shelf.plan, z0, z1: z0 + board, translucent: false });
  });
  // The doors: see-through, a board thick, just outside the doors edges, the full height.
  for (const edge of geometry.edges) {
    if (roles[edge.index] !== "doors") continue;
    push({ key: `door:${edge.index}`, part: `door:${edge.index}`, kind: "door", polygon: edgeStrip(edge, 0, 0, -Math.max(t, 1)), z0: 0, z1: H, translucent: true });
  }
  if (!prisms.length) return empty;
  const xs = prisms.flatMap((prism) => prism.polygon.map((p) => p[0]));
  const ys = prisms.flatMap((prism) => prism.polygon.map((p) => p[1]));
  return {
    prisms,
    height: H,
    thicknessMm: t,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      minZ: Math.min(...prisms.map((prism) => prism.z0)),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
      maxZ: Math.max(...prisms.map((prism) => prism.z1)),
    },
  };
}

// ---- The model's faces, for drawing it: each prism's sides and its two ends. Points are [x, y, z] (mm — x and y the
// drawing's, y down the page; z up); normal: outward, a unit vector in the same.
export type CabinetPoint3 = [number, number, number];
export type CabinetFace = {
  key: string;
  part: string;
  kind: CabinetPrismKind;
  translucent: boolean;
  points: CabinetPoint3[];
  normal: CabinetPoint3;
};
// The faces seen from a view — turned by `yaw` (round the upright) and `pitch` (looking down), fitted to a `width` ×
// `height` box (px) whichever way it's turned — the ones facing away left out, the rest in the order to draw them, back
// to front: each with its points on the screen (px, y down), how far back its middle is, and how lit (0–1: lit from up,
// left and in front).
//
// Back to front: no one depth for a face does it for thin boards (a tall end's middle is behind a shelf's edge it hides;
// a big L-shaped shelf's nearest corner is in front of the end it's behind). So any two that overlap on the screen are
// put in order by their planes — one wholly behind the other's plane (or the other wholly in front of its) is drawn
// first — and the rest by their middles.
export type CabinetView = { yaw: number; pitch: number };
export type CabinetScreenFace = CabinetFace & { screen: Array<[number, number]>; depth: number; light: number };
export function projectCabinetFaces(model: CabinetModel, faces: CabinetFace[], view: CabinetView, size: { width: number; height: number }): CabinetScreenFace[] {
  const b = model.bounds;
  const centre: CabinetPoint3 = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2];
  const reach = Math.max(1, Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2);
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  // (The drawing's x across, its y towards the front, z up — seen from the front: x right, z up, y towards the eye.)
  const turn = (x: number, y: number, z: number): CabinetPoint3 => {
    const x1 = x * cy + y * sy;
    const z1 = -x * sy + y * cy;
    return [x1, z * cp - z1 * sp, z * sp + z1 * cp];
  };
  const k = (Math.min(size.width, size.height) * 0.44) / reach;
  const light: CabinetPoint3 = [-0.35, 0.78, 0.52];
  const lightLength = Math.hypot(light[0], light[1], light[2]);
  type Seen = CabinetScreenFace & { box: { left: number; top: number; right: number; bottom: number } };
  const seen: Seen[] = [];
  for (const face of faces) {
    const n = turn(face.normal[0], face.normal[1], face.normal[2]);
    // (Facing away: behind the faces in front of it.)
    if (n[2] <= 1e-6 || !face.points.length) continue;
    let middle = 0;
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    const screen = face.points.map((p) => {
      const [x, y, z] = turn(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]);
      middle += z;
      const at: [number, number] = [size.width / 2 + x * k, size.height / 2 - y * k];
      box.left = Math.min(box.left, at[0]);
      box.right = Math.max(box.right, at[0]);
      box.top = Math.min(box.top, at[1]);
      box.bottom = Math.max(box.bottom, at[1]);
      return at;
    });
    const lit = Math.max(0, (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / lightLength);
    seen.push({ ...face, screen, depth: middle / face.points.length, light: lit, box });
  }

  // Which side of face `plane`'s plane each point of `face` is (model space — the same whichever way it's turned):
  // all behind it (−), or all in front (+).
  const PLANE_SLACK_MM = 0.05;
  const allBehind = (face: CabinetFace, plane: CabinetFace) => {
    const o = plane.points[0];
    const nn = plane.normal;
    return face.points.every((p) => (p[0] - o[0]) * nn[0] + (p[1] - o[1]) * nn[1] + (p[2] - o[2]) * nn[2] <= PLANE_SLACK_MM);
  };
  const allInFront = (face: CabinetFace, plane: CabinetFace) => {
    const o = plane.points[0];
    const nn = plane.normal;
    return face.points.every((p) => (p[0] - o[0]) * nn[0] + (p[1] - o[1]) * nn[1] + (p[2] - o[2]) * nn[2] >= -PLANE_SLACK_MM);
  };
  const m = seen.length;
  const before: number[][] = seen.map(() => []);
  const waiting = new Array<number>(m).fill(0);
  const OVERLAP_PX = 0.5;
  for (let i = 0; i < m; i += 1) {
    const a = seen[i];
    for (let j = i + 1; j < m; j += 1) {
      const c = seen[j];
      if (a.box.right <= c.box.left + OVERLAP_PX || c.box.right <= a.box.left + OVERLAP_PX || a.box.bottom <= c.box.top + OVERLAP_PX || c.box.bottom <= a.box.top + OVERLAP_PX) continue;
      const aFirst = allBehind(a, c) || allInFront(c, a);
      const cFirst = allBehind(c, a) || allInFront(a, c);
      if (aFirst && !cFirst) {
        before[i].push(j);
        waiting[j] += 1;
      } else if (cFirst && !aFirst) {
        before[j].push(i);
        waiting[i] += 1;
      }
    }
  }
  // Drawn in that order — of those free to go next, the furthest back first (a loop, if any: the furthest of it).
  const done = new Array<boolean>(m).fill(false);
  const out: CabinetScreenFace[] = [];
  for (let step = 0; step < m; step += 1) {
    let pick = -1;
    for (let i = 0; i < m; i += 1) {
      if (done[i] || waiting[i] > 0) continue;
      if (pick < 0 || seen[i].depth < seen[pick].depth) pick = i;
    }
    if (pick < 0) {
      for (let i = 0; i < m; i += 1) if (!done[i] && (pick < 0 || seen[i].depth < seen[pick].depth)) pick = i;
    }
    done[pick] = true;
    for (const next of before[pick]) waiting[next] -= 1;
    const { box, ...face } = seen[pick];
    void box;
    out.push(face);
  }
  return out;
}

export function cabinetModelFaces(model: CabinetModel): CabinetFace[] {
  const faces: CabinetFace[] = [];
  for (const prism of model.prisms) {
    const { polygon, z0, z1 } = prism;
    const base = { part: prism.part, kind: prism.kind, translucent: prism.translucent };
    faces.push({ ...base, key: `${prism.key}:top`, points: polygon.map((p) => [p[0], p[1], z1] as CabinetPoint3), normal: [0, 0, 1] });
    faces.push({ ...base, key: `${prism.key}:bottom`, points: [...polygon].reverse().map((p) => [p[0], p[1], z0] as CabinetPoint3), normal: [0, 0, -1] });
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      const d = unit(sub(b, a));
      if (!len(d)) return;
      faces.push({
        ...base,
        key: `${prism.key}:side${i}`,
        points: [
          [a[0], a[1], z0],
          [b[0], b[1], z0],
          [b[0], b[1], z1],
          [a[0], a[1], z1],
        ],
        // (Wound clockwise on the screen: out is to the left of the way it runs, y down.)
        normal: [d[1], -d[0], 0],
      });
    });
  }
  return faces;
}

// ---- The cabinet everywhere else: the cutlists, the CNC Cutlist, nesting, prints, labels and Excel (the project page,
// components/cutlist-shape-drawing.tsx, lib/cutlist-print-pdf.ts, lib/cutlist-excel.ts).

// Its parts and its model worked out once for each shape and board thickness — the same shape (the same object, as a
// row keeps it) at the same thickness: the same ones.
const partsCache = new WeakMap<CutlistShape, Map<number, CabinetPart[]>>();
const modelCache = new WeakMap<CutlistShape, Map<number, CabinetModel>>();
const thicknessKey = (thicknessMm: number) => {
  const t = Number(thicknessMm);
  return Number.isFinite(t) && t > 0 ? Math.round(t * 1000) / 1000 : 0;
};
export function cachedCustomCabinetParts(shape: CutlistShape, thicknessMm: number): CabinetPart[] {
  const key = thicknessKey(thicknessMm);
  let byThickness = partsCache.get(shape);
  if (!byThickness) {
    byThickness = new Map();
    partsCache.set(shape, byThickness);
  }
  let parts = byThickness.get(key);
  if (!parts) {
    parts = customCabinetParts(shape, { thicknessMm: key });
    byThickness.set(key, parts);
  }
  return parts;
}
export function cachedCustomCabinetModel(shape: CutlistShape, thicknessMm: number): CabinetModel {
  const key = thicknessKey(thicknessMm);
  let byThickness = modelCache.get(shape);
  if (!byThickness) {
    byThickness = new Map();
    modelCache.set(shape, byThickness);
  }
  let model = byThickness.get(key);
  if (!model) {
    model = customCabinetModel(shape, { thicknessMm: key });
    byThickness.set(key, model);
  }
  return model;
}

// Its size as a cabinet's: its height, and the box round its top view — Width across the drawing, Depth down it.
export type CustomCabinetSize = { height: number; width: number; depth: number };
export function customCabinetSize(shape: CutlistShape): CustomCabinetSize {
  const outer = shapeOuterSize(shape);
  return { height: cabinetSettings(shape).height, width: outer.width, depth: outer.height };
}
// "H 720 × W 1311 × D 1138".
export function customCabinetSizeText(shape: CutlistShape): string {
  const size = customCabinetSize(shape);
  return `H ${formatShapeMm(size.height)} × W ${formatShapeMm(size.width)} × D ${formatShapeMm(size.depth)}`;
}

// Its parts as they're listed: each Back and End numbered when it has more than one ("Back 1", "Back 2" — in the
// outline's order), the rest by name; with mergeTopBottom, its Top and Bottom one line ("Top / Bottom", both of them —
// they're the same shape), as the cabinets' own breakdown has them.
export type CabinetPartLine = { key: string; label: string; quantity: number; part: CabinetPart; parts: CabinetPart[] };
export function customCabinetPartLines(parts: CabinetPart[], options: { mergeTopBottom?: boolean } = {}): CabinetPartLine[] {
  const count = (name: CabinetPartName) => parts.filter((part) => part.name === name).length;
  const seen: Partial<Record<CabinetPartName, number>> = {};
  const lines: CabinetPartLine[] = [];
  for (const part of parts) {
    const nth = (seen[part.name] = (seen[part.name] ?? 0) + 1);
    const numbered = (part.name === "Back" || part.name === "End") && count(part.name) > 1;
    lines.push({ key: part.key, label: numbered ? `${part.name} ${nth}` : part.name, quantity: part.quantity, part, parts: [part] });
  }
  if (!options.mergeTopBottom) return lines;
  const top = lines.find((line) => line.part.name === "Top");
  const bottom = lines.find((line) => line.part.name === "Bottom");
  if (!top || !bottom || Boolean(top.part.problem) !== Boolean(bottom.part.problem)) return lines;
  return lines
    .filter((line) => line !== bottom)
    .map((line) => (line === top ? { ...top, key: "top-bottom", label: "Top / Bottom", quantity: top.quantity + bottom.quantity, parts: [top.part, bottom.part] } : line));
}

// How much of its parts is edge banded (mm, for one cabinet): its shaped parts' doors edges, each as many times as it's
// made. (Its ends' front edges are taped too — as a cabinet's sides are, by their clashing: the project page adds them.)
export function customCabinetBandedLengthMm(parts: CabinetPart[]): number {
  let mm = 0;
  for (const part of parts) {
    if (part.kind !== "shape" || !part.shape) continue;
    mm += shapeGeometry(part.shape).bandedLengthMm * Math.max(0, part.quantity);
  }
  return mm;
}
// "2.84 m banded" — a custom cabinet's Clashing cell: its shaped parts' banding, all of them.
export function customCabinetBandingSummary(parts: CabinetPart[]): string {
  const mm = customCabinetBandedLengthMm(parts);
  return mm > 0 ? `${formatShapeMetres(mm)} m banded` : "No banding";
}

// ---- Its top view as a drawing (lib/cutlist-shape-render.ts's steps — on white paper): its outline and dimensions as a
// flat piece's (no banding — a cabinet's top view has none of its own), its backs and ends drawn in, a board thick (in
// their roles' colours), and its doors edges a heavier line in theirs.
export type CabinetPlanDrawingOptions = ShapeDrawingOptions & { thicknessMm: number };
const PLAN_SAMPLING = { stepRadians: Math.PI / 90, toleranceMm: 0.05 };
export function cabinetPlanDrawingOps(shape: CutlistShape, opts: CabinetPlanDrawingOptions): ShapeDrawing {
  const drawing = shapeDrawingOps({ ...shape, banded: [] }, { ...opts, showBandingArrows: false });
  const geometry = shapeGeometry(shape);
  if (!geometry.valid) return drawing;
  const k = Math.max(4, opts.fontSize ?? 10) / 10;
  const extra: ShapeDrawingOp[] = [];
  for (const prism of cachedCustomCabinetModel(shape, opts.thicknessMm).prisms) {
    if (prism.kind !== "back" && prism.kind !== "end") continue;
    const color = CABINET_EDGE_ROLE_COLORS[prism.kind];
    extra.push({ kind: "path", points: prism.polygon.map(drawing.toPx), closed: true, fill: color, fillOpacity: 0.4, stroke: color, lineWidth: 0.8 * k, lineJoin: "round" });
  }
  for (const { role, chain } of cabinetRoleChains(geometry, cabinetEdgeRoles(shape))) {
    if (role !== "doors") continue;
    const line = shapeChainPoints(geometry, chain, PLAN_SAMPLING).map(drawing.toPx);
    if (line.length < 2) continue;
    extra.push({ kind: "path", points: line, closed: false, stroke: CABINET_EDGE_ROLE_COLORS.doors, lineWidth: 2.4 * k, lineCap: chain.closed ? "butt" : "round", lineJoin: "round" });
  }
  // (Over its outline's wash, under its dimensions and numbers.)
  const outlineAt = drawing.ops.findIndex((op) => op.kind === "path");
  const ops = outlineAt < 0 ? [...drawing.ops, ...extra] : [...drawing.ops.slice(0, outlineAt + 1), ...extra, ...drawing.ops.slice(outlineAt + 1)];
  return { ...drawing, ops };
}
// As a standalone SVG's markup, and as a PNG (a browser only — a canvas), as a flat piece's drawing is.
export function cabinetPlanSvg(shape: CutlistShape, opts: CabinetPlanDrawingOptions): string {
  return shapeDrawingOpsToSvg(cabinetPlanDrawingOps(shape, opts));
}
export function cabinetPlanPngDataUrl(shape: CutlistShape, opts: CabinetPlanDrawingOptions & { pixelRatio?: number }): Promise<string> {
  if (typeof document === "undefined") return Promise.resolve("");
  try {
    const drawing = cabinetPlanDrawingOps(shape, opts);
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
