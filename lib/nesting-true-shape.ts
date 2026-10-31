// True-shape nesting (Production › Nesting, on a CNC): every piece placed by its real outline, not the box round it — so
// a small piece can sit in an L's empty corner or a U's middle, and shapes can interlock. Pure geometry, no React and no
// imports (the project page turns its rows into items; node tests run it as it is).
//
//  - A piece is a polygon in its box (mm, y down, the box's top left at 0, 0): its outline with its curves sampled, or
//    null for a plain rectangle. It may take any of the quarter turns it's given (clockwise) — never mirrored, its faces
//    and banding matter.
//  - Pieces keep `gap` (the kerf) between them: no point of one closer than that to any point of another — the same as
//    each grown by half the gap (a round-cornered offset, as a router bit leaves). A piece whose outline was sampled
//    from curves keeps `pad` more, so the true curve between its sampled points can't come closer than the gap.
//  - Placement is bottom-left fill: units in the order given (biggest first), each onto the first sheet it fits on.
//    On a sheet it tries, for each turn, positions touching what's already there — the sheet's corners, beside and
//    under each placed piece's box, and off each placed piece's corners (into an L's corner or a U's middle) — in
//    left-most then top-most order, takes the first that's clear, then slides it left and up until it touches. The
//    best turn wins. Clear means: inside the sheet, and the gap from every placed piece (edge to edge distances, a
//    piece wholly inside another caught too), boxes compared first and a grid of the sheet keeping it to neighbours.

export type NestPoint = [number, number];

export type TrueShapeItem = {
  // Its box at no turn (mm): w across, h down.
  w: number;
  h: number;
  // Its outline in that box (mm, y down), or null: a rectangle filling it.
  outline: NestPoint[] | null;
  // More clearance than the gap (mm) for an outline sampled from curves (see above); 0 for straight ones.
  pad: number;
  // The quarter turns (clockwise) it may take, e.g. [0, 1, 2, 3], or [0, 2] for a grained piece.
  turns: number[];
  // The same for pieces of the same shape and size: one that wouldn't fit a sheet, its twin won't either.
  shapeKey: string;
};

export type TrueShapeUnit = {
  items: TrueShapeItem[];
  // A set laid out together (a configured door's fronts): one block w × h, never turned, its items at their offsets
  // in it (no turn). Without it, a unit of more than one item goes all on one sheet, each placed in turn.
  locked?: { w: number; h: number; offsets: Array<{ x: number; y: number }> };
};

// Where an item went: its unit and item (by index), its turned box's top left on the sheet (x, y) and its turn.
export type TrueShapePlacement = { unit: number; item: number; x: number; y: number; turn: number };

export type TrueShapeOptions = { sheetW: number; sheetH: number; gap: number };

// The least clearance kept, even at no kerf: touching and overlapping can't be told apart by distance alone.
const MIN_CLEARANCE = 0.01;
// Distances this close to the clearance count as clear (floating point), and a slide stops this short of touching.
const TOL = 1e-6;
const SLIDE_BACKOFF = 1e-6;
// The sheet's grid (mm) for finding a piece's neighbours.
const GRID_CELL = 200;
// At most this many of a placed piece's corners are tried as places to tuck a piece against.
const MAX_KEY_POINTS = 24;

// ---- Outlines.

// An outline in its w × h box, turned `turn` quarter turns clockwise (y down) — in its new box (h × w when odd).
export function turnOutline(points: NestPoint[], w: number, h: number, turn: number): NestPoint[] {
  const t = ((turn % 4) + 4) % 4;
  if (t === 0) return points.map(([u, v]): NestPoint => [u, v]);
  if (t === 1) return points.map(([u, v]): NestPoint => [h - v, u]);
  if (t === 2) return points.map(([u, v]): NestPoint => [w - u, h - v]);
  return points.map(([u, v]): NestPoint => [v, w - u]);
}

// Its area (mm²), either way round.
export function polygonArea(points: NestPoint[]): number {
  let sum = 0;
  for (let i = 0, n = points.length; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

function pointInPolygon(x: number, y: number, points: NestPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Does segment a–b pass through the inside of the box (not just along or touching its sides)?
function segmentCrossesBoxInside(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const e = 1e-7;
  x0 += e;
  y0 += e;
  x1 -= e;
  y1 -= e;
  if (x1 <= x0 || y1 <= y0) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-15) return q > 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay) && t1 > t0;
}

// The coordinates a grid over the outline is cut at (along x, `axis` 0, or y): where its longer straight edges start and
// end (an L's legs, a notch), and evenly between — so the grid follows its real corners, its curves only roughly.
function gridCuts(points: NestPoint[], axis: 0 | 1, size: number): number[] {
  const n = points.length;
  const values: number[] = [];
  for (let i = 0; i <= 16; i += 1) values.push((size * i) / 16);
  const longEdge = size / 40;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < longEdge) continue;
    values.push(a[axis], b[axis]);
  }
  const sorted = values.map((v) => Math.min(size, Math.max(0, v))).sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (!out.length || v - out[out.length - 1] > 0.5) out.push(v);
  out[out.length - 1] = size;
  return out;
}

// A big box wholly inside the outline (mm, in its w × h box) — where a piece's name goes, so it's on the piece and not
// in an L's empty corner. (The largest made of a grid's cells — the grid cut at the outline's corners.) null: none.
export function largestInsideRect(points: NestPoint[] | null, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  if (!points) return { x: 0, y: 0, w, h };
  if (points.length < 3 || !(w > 0) || !(h > 0)) return null;
  const xs = gridCuts(points, 0, w);
  const ys = gridCuts(points, 1, h);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  if (nx < 1 || ny < 1) return null;
  const n = points.length;
  const heights = new Array<number>(nx).fill(0);
  let best: { x: number; y: number; w: number; h: number } | null = null;
  let bestArea = 0;
  for (let j = 0; j < ny; j += 1) {
    const y0 = ys[j];
    const y1 = ys[j + 1];
    for (let i = 0; i < nx; i += 1) {
      const x0 = xs[i];
      const x1 = xs[i + 1];
      let solid = pointInPolygon((x0 + x1) / 2, (y0 + y1) / 2, points);
      for (let k = 0; solid && k < n; k += 1) {
        const a = points[k];
        const b = points[(k + 1) % n];
        if (segmentCrossesBoxInside(a[0], a[1], b[0], b[1], x0, y0, x1, y1)) solid = false;
      }
      heights[i] = solid ? heights[i] + (y1 - y0) : 0;
    }
    // (The biggest box standing on this row: each column as tall as it goes, as wide as its neighbours are as tall.)
    for (let i = 0; i < nx; i += 1) {
      const hi = heights[i];
      if (hi <= 0) continue;
      let l = i;
      while (l > 0 && heights[l - 1] >= hi) l -= 1;
      let r = i;
      while (r < nx - 1 && heights[r + 1] >= hi) r += 1;
      const area = hi * (xs[r + 1] - xs[l]);
      if (area > bestArea + 1e-9) {
        bestArea = area;
        best = { x: xs[l], y: y1 - hi, w: xs[r + 1] - xs[l], h: hi };
      }
    }
  }
  return best;
}

// ---- A piece as it's packed.

type Poly = {
  w: number;
  h: number;
  pts: NestPoint[];
  // Its edges (from point i to i + 1), flat: ax, ay, bx, by.
  ex: Float64Array;
  n: number;
  rect: boolean;
  pad: number;
  area: number;
  // A box wholly inside it (its material), for a quick "certainly too close".
  solid: { x: number; y: number; w: number; h: number } | null;
  // Its corners to tuck other pieces against — and which of them are outside (convex) and inside (reflex) ones.
  keys: NestPoint[];
  convex: NestPoint[];
  reflex: NestPoint[];
};

function cleanOutline(points: NestPoint[], w: number, h: number): NestPoint[] {
  const out: NestPoint[] = [];
  for (const [x, y] of points) {
    const p: NestPoint = [Math.min(w, Math.max(0, x)), Math.min(h, Math.max(0, y))];
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-6) out.pop();
  // (Points in a straight line with their neighbours aren't corners.)
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i += 1) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (Math.abs(cross) <= 1e-9 * Math.max(1, l * l)) {
        out.splice(i, 1);
        changed = true;
        i -= 1;
      }
    }
  }
  return out;
}

function buildPoly(outline: NestPoint[] | null, w: number, h: number, pad: number, solid?: Poly["solid"]): Poly {
  const rectPts: NestPoint[] = [[0, 0], [w, 0], [w, h], [0, h]];
  let pts = outline ? cleanOutline(outline, w, h) : rectPts;
  if (pts.length < 3) pts = rectPts;
  const area = polygonArea(pts);
  const rect = pts === rectPts || (pts.length === 4 && Math.abs(area - w * h) <= 1e-6 * Math.max(1, w * h));
  if (rect) pts = rectPts;
  const n = pts.length;
  const ex = new Float64Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    ex[i * 4] = a[0];
    ex[i * 4 + 1] = a[1];
    ex[i * 4 + 2] = b[0];
    ex[i * 4 + 3] = b[1];
  }
  // Its corners: every point of a simple outline; of a sampled curve, only where it turns sharply (and its extremes).
  let signed = 0;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    signed += a[0] * b[1] - b[0] * a[1];
  }
  const orient = signed >= 0 ? 1 : -1;
  const turning: Array<{ p: NestPoint; turn: number; reflex: boolean }> = [];
  for (let i = 0; i < n; i += 1) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    const cross = ux * vy - uy * vx;
    const turn = Math.abs(Math.atan2(cross, ux * vx + uy * vy));
    turning.push({ p: b, turn, reflex: cross * orient < 0 });
  }
  let keys = turning.filter((t) => n <= MAX_KEY_POINTS || t.turn > (20 * Math.PI) / 180);
  if (keys.length > MAX_KEY_POINTS) keys = [...keys].sort((a, b) => b.turn - a.turn).slice(0, MAX_KEY_POINTS);
  return {
    w,
    h,
    pts,
    ex,
    n,
    rect,
    pad: rect ? 0 : Math.max(0, pad),
    area,
    solid: rect ? { x: 0, y: 0, w, h } : solid !== undefined ? solid : largestInsideRect(pts, w, h),
    keys: keys.map((t) => t.p),
    convex: keys.filter((t) => !t.reflex).map((t) => t.p),
    reflex: keys.filter((t) => t.reflex).map((t) => t.p),
  };
}

// ---- Distances.

function pointSegDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

function orient2d(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segSegDist2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const d1 = orient2d(cx, cy, dx, dy, ax, ay);
  const d2 = orient2d(cx, cy, dx, dy, bx, by);
  const d3 = orient2d(ax, ay, bx, by, cx, cy);
  const d4 = orient2d(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    pointSegDist2(ax, ay, cx, cy, dx, dy),
    pointSegDist2(bx, by, cx, cy, dx, dy),
    pointSegDist2(cx, cy, ax, ay, bx, by),
    pointSegDist2(dx, dy, ax, ay, bx, by),
  );
}

// Sliding: where along the line x = 0 a point (0, s) is closer than c to segment p–q — the interval widened into
// (ivLo, ivHi) (it's convex, so the union of the round ends and the band between them is one interval).
let ivLo = Infinity;
let ivHi = -Infinity;
function capsuleOnYAxis(px: number, py: number, qx: number, qy: number, c: number) {
  const c2 = c * c;
  if (px * px < c2) {
    const half = Math.sqrt(c2 - px * px);
    if (py - half < ivLo) ivLo = py - half;
    if (py + half > ivHi) ivHi = py + half;
  }
  if (qx * qx < c2) {
    const half = Math.sqrt(c2 - qx * qx);
    if (qy - half < ivLo) ivLo = qy - half;
    if (qy + half > ivHi) ivHi = qy + half;
  }
  const dx = qx - px;
  const dy = qy - py;
  const l2 = dx * dx + dy * dy;
  if (l2 <= 1e-18) return;
  const l = Math.sqrt(l2);
  let lo = -Infinity;
  let hi = Infinity;
  // Beside the segment: |dx·s + k| < c·l, k = dy·px − dx·py.
  const k = dy * px - dx * py;
  if (Math.abs(dx) < 1e-15) {
    if (!(Math.abs(k) < c * l)) return;
  } else {
    const a = (-c * l - k) / dx;
    const b = (c * l - k) / dx;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  }
  // Within its length: 0 ≤ −px·dx + (s − py)·dy ≤ l².
  if (Math.abs(dy) < 1e-15) {
    const v = -px * dx;
    if (v < 0 || v > l2) return;
  } else {
    const a = py + (px * dx) / dy;
    const b = py + (l2 + px * dx) / dy;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  }
  if (lo < hi) {
    if (lo < ivLo) ivLo = lo;
    if (hi > ivHi) ivHi = hi;
  }
}

// How far (t) segment a moving by −t along an axis (x: `alongX`, else y) is closer than c to fixed segment b: the
// interval (lo, hi), or null. (The point −t·axis against b's points less a's — a parallelogram, grown by c.)
let slideLo = 0;
let slideHi = 0;
function slideInterval(
  ax0: number, ay0: number, ax1: number, ay1: number,
  bx0: number, by0: number, bx1: number, by1: number,
  c: number, alongX: boolean,
): boolean {
  // The parallelogram's corners: b0 − a0, b1 − a0, b1 − a1, b0 − a1 (swapped onto the y axis when sliding along x).
  let v0x = bx0 - ax0, v0y = by0 - ay0;
  let v1x = bx1 - ax0, v1y = by1 - ay0;
  let v2x = bx1 - ax1, v2y = by1 - ay1;
  let v3x = bx0 - ax1, v3y = by0 - ay1;
  if (alongX) {
    [v0x, v0y] = [v0y, v0x];
    [v1x, v1y] = [v1y, v1x];
    [v2x, v2y] = [v2y, v2x];
    [v3x, v3y] = [v3y, v3x];
  }
  ivLo = Infinity;
  ivHi = -Infinity;
  capsuleOnYAxis(v0x, v0y, v1x, v1y, c);
  capsuleOnYAxis(v1x, v1y, v2x, v2y, c);
  capsuleOnYAxis(v2x, v2y, v3x, v3y, c);
  capsuleOnYAxis(v3x, v3y, v0x, v0y, c);
  if (!(ivLo < ivHi)) return false;
  // (The point is (0, −t): s = −t.)
  slideLo = -ivHi;
  slideHi = -ivLo;
  return true;
}

// ---- A sheet.

type Placed = { poly: Poly; x: number; y: number; x1: number; y1: number };
type Sheet = {
  placed: Placed[];
  grid: Map<number, number[]>;
  freeArea: number;
  // Shapes that didn't fit here (it only ever fills up, so they never will) — and the boxes that didn't, as they lay
  // (w × h): a piece with a box inside it at least that big, any way it may lie, won't either.
  failed: Set<string>;
  failedBoxes: Array<[number, number]>;
  // The piece that last got in the way — tried first next time.
  lastHit: number;
};

const cellKey = (cx: number, cy: number) => cy * 4096 + cx;

export function packTrueShapes(units: TrueShapeUnit[], options: TrueShapeOptions): TrueShapePlacement[][] {
  const W = options.sheetW;
  const H = options.sheetH;
  const gap = Math.max(MIN_CLEARANCE, options.gap || 0);
  const sheets: Sheet[] = [];
  const out: TrueShapePlacement[][] = [];
  let stamp = 1;
  const seen: number[] = [];
  const near: number[] = [];

  const polyCache = new Map<string, Poly>();
  const solidCache = new Map<string, Poly["solid"]>();
  const polyFor = (item: TrueShapeItem, turn: number): Poly => {
    const key = `${item.shapeKey}|${item.w}|${item.h}|${item.pad}|${turn}`;
    let poly = polyCache.get(key);
    if (!poly) {
      const odd = turn % 2 === 1;
      const bw = odd ? item.h : item.w;
      const bh = odd ? item.w : item.h;
      // (Its inside box worked out once, at no turn, and turned with it.)
      let solid: Poly["solid"] | undefined;
      if (item.outline) {
        const solidKey = `${item.shapeKey}|${item.w}|${item.h}`;
        if (!solidCache.has(solidKey)) solidCache.set(solidKey, largestInsideRect(cleanOutline(item.outline, item.w, item.h), item.w, item.h));
        const base = solidCache.get(solidKey) ?? null;
        if (base) {
          const [[ax, ay], [bx, by]] = turnOutline([[base.x, base.y], [base.x + base.w, base.y + base.h]], item.w, item.h, turn);
          solid = { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
        } else solid = null;
      }
      poly = buildPoly(item.outline ? turnOutline(item.outline, item.w, item.h, turn) : null, bw, bh, item.pad, solid);
      polyCache.set(key, poly);
    }
    return poly;
  };

  const newSheet = (): number => {
    sheets.push({ placed: [], grid: new Map(), freeArea: W * H, failed: new Set(), failedBoxes: [], lastHit: -1 });
    out.push([]);
    return sheets.length - 1;
  };

  // The placed pieces whose boxes come near x0..x1 × y0..y1 (into `near`).
  const gatherNear = (sheet: Sheet, x0: number, y0: number, x1: number, y1: number) => {
    near.length = 0;
    stamp += 1;
    const cx0 = Math.max(0, Math.floor(x0 / GRID_CELL));
    const cy0 = Math.max(0, Math.floor(y0 / GRID_CELL));
    const cx1 = Math.max(0, Math.floor(x1 / GRID_CELL));
    const cy1 = Math.max(0, Math.floor(y1 / GRID_CELL));
    for (let cy = cy0; cy <= cy1; cy += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const list = sheet.grid.get(cellKey(cx, cy));
        if (!list) continue;
        for (const idx of list) {
          if (seen[idx] === stamp) continue;
          seen[idx] = stamp;
          const q = sheet.placed[idx];
          if (q.x1 < x0 || q.x > x1 || q.y1 < y0 || q.y > y1) continue;
          near.push(idx);
        }
      }
    }
  };

  // Is P at (px, py) closer than its clearance to placed piece Q?
  const collides = (p: Poly, px: number, py: number, q: Placed): boolean => {
    const c = gap + p.pad + q.poly.pad;
    const lim = c - TOL;
    const lim2 = lim * lim;
    const pX1 = px + p.w;
    const pY1 = py + p.h;
    const bdx = Math.max(0, q.x - pX1, px - q.x1);
    const bdy = Math.max(0, q.y - pY1, py - q.y1);
    if (bdx * bdx + bdy * bdy >= lim2) return false;
    if (p.rect && q.poly.rect) return true;
    const ps = p.solid;
    const qs = q.poly.solid;
    if (ps && qs) {
      const sdx = Math.max(0, q.x + qs.x - (px + ps.x + ps.w), px + ps.x - (q.x + qs.x + qs.w));
      const sdy = Math.max(0, q.y + qs.y - (py + ps.y + ps.h), py + ps.y - (q.y + qs.y + qs.h));
      if (sdx * sdx + sdy * sdy < lim2) return true;
    }
    const pe = p.ex;
    const qe = q.poly.ex;
    const qn = q.poly.n;
    for (let i = 0; i < p.n; i += 1) {
      const ax = pe[i * 4] + px;
      const ay = pe[i * 4 + 1] + py;
      const bx = pe[i * 4 + 2] + px;
      const by = pe[i * 4 + 3] + py;
      const ex0 = Math.min(ax, bx) - c;
      const ex1 = Math.max(ax, bx) + c;
      const ey0 = Math.min(ay, by) - c;
      const ey1 = Math.max(ay, by) + c;
      if (ex1 < q.x || ex0 > q.x1 || ey1 < q.y || ey0 > q.y1) continue;
      for (let j = 0; j < qn; j += 1) {
        const cx = qe[j * 4] + q.x;
        const cy = qe[j * 4 + 1] + q.y;
        const dx = qe[j * 4 + 2] + q.x;
        const dy = qe[j * 4 + 3] + q.y;
        if ((cx < ex0 && dx < ex0) || (cx > ex1 && dx > ex1) || (cy < ey0 && dy < ey0) || (cy > ey1 && dy > ey1)) continue;
        if (segSegDist2(ax, ay, bx, by, cx, cy, dx, dy) < lim2) return true;
      }
    }
    // (No edges near each other — but one could still be wholly inside the other.)
    if (px < q.x1 && pX1 > q.x && py < q.y1 && pY1 > q.y) {
      const ax = p.pts[0][0] + px;
      const ay = p.pts[0][1] + py;
      if (ax > q.x && ax < q.x1 && ay > q.y && ay < q.y1 && pointInPolygon(ax - q.x, ay - q.y, q.poly.pts)) return true;
      const bx = q.poly.pts[0][0] + q.x;
      const by = q.poly.pts[0][1] + q.y;
      if (bx > px && bx < pX1 && by > py && by < pY1 && pointInPolygon(bx - px, by - py, p.pts)) return true;
    }
    return false;
  };

  const fits = (sheet: Sheet, p: Poly, px: number, py: number): boolean => {
    if (px < -TOL || py < -TOL || px + p.w > W + TOL || py + p.h > H + TOL) return false;
    if (sheet.lastHit >= 0 && sheet.lastHit < sheet.placed.length && collides(p, px, py, sheet.placed[sheet.lastHit])) return false;
    const reach = gap + p.pad + 1;
    gatherNear(sheet, px - reach, py - reach, px + p.w + reach, py + p.h + reach);
    for (const idx of near) {
      if (collides(p, px, py, sheet.placed[idx])) {
        sheet.lastHit = idx;
        return false;
      }
    }
    return true;
  };

  // How far P at (px, py) can slide left (alongX) or up before it comes within its clearance of anything.
  const slideRoom = (sheet: Sheet, p: Poly, px: number, py: number, alongX: boolean): number => {
    let limit = alongX ? px : py;
    if (limit <= TOL) return 0;
    const reach = gap + p.pad + 1;
    if (alongX) gatherNear(sheet, px - limit - reach, py - reach, px + p.w + reach, py + p.h + reach);
    else gatherNear(sheet, px - reach, py - limit - reach, px + p.w + reach, py + p.h + reach);
    const nearHere = near.slice();
    const pe = p.ex;
    for (const idx of nearHere) {
      const q = sheet.placed[idx];
      const c = gap + p.pad + q.poly.pad;
      // (Its box swept along the way it can still go.)
      const sx0 = (alongX ? px - limit : px) - c;
      const sy0 = (alongX ? py : py - limit) - c;
      if (q.x1 < sx0 || q.x > px + p.w + c || q.y1 < sy0 || q.y > py + p.h + c) continue;
      const qe = q.poly.ex;
      for (let i = 0; i < p.n; i += 1) {
        const ax = pe[i * 4] + px;
        const ay = pe[i * 4 + 1] + py;
        const bx = pe[i * 4 + 2] + px;
        const by = pe[i * 4 + 3] + py;
        const ex0 = Math.min(ax, bx) - c - (alongX ? limit : 0);
        const ex1 = Math.max(ax, bx) + c;
        const ey0 = Math.min(ay, by) - c - (alongX ? 0 : limit);
        const ey1 = Math.max(ay, by) + c;
        if (ex1 < q.x || ex0 > q.x1 || ey1 < q.y || ey0 > q.y1) continue;
        for (let j = 0; j < q.poly.n; j += 1) {
          const cx = qe[j * 4] + q.x;
          const cy = qe[j * 4 + 1] + q.y;
          const dx = qe[j * 4 + 2] + q.x;
          const dy = qe[j * 4 + 3] + q.y;
          if ((cx < ex0 && dx < ex0) || (cx > ex1 && dx > ex1) || (cy < ey0 && dy < ey0) || (cy > ey1 && dy > ey1)) continue;
          if (!slideInterval(ax, ay, bx, by, cx, cy, dx, dy, c, alongX)) continue;
          if (slideHi <= TOL || slideLo >= limit) continue;
          limit = Math.max(0, slideLo);
          if (limit <= TOL) return 0;
        }
      }
    }
    return Math.max(0, limit - SLIDE_BACKOFF);
  };

  // Its best clear spot on a sheet at this turn (left-most, then top-most), or null.
  const bestSpot = (sheet: Sheet, p: Poly): { x: number; y: number } | null => {
    if (p.w > W + TOL || p.h > H + TOL) return null;
    const maxX = Math.max(0, W - p.w);
    const maxY = Math.max(0, H - p.h);
    const xs: number[] = [];
    const ys: number[] = [];
    const push = (x: number, y: number) => {
      xs.push(x < 0 ? 0 : x > maxX ? maxX : x);
      ys.push(y < 0 ? 0 : y > maxY ? maxY : y);
    };
    push(0, 0);
    push(0, maxY);
    push(maxX, 0);
    for (const q of sheet.placed) {
      const c = gap + p.pad + q.poly.pad + SLIDE_BACKOFF;
      push(q.x1 + c, q.y);
      push(q.x, q.y1 + c);
      push(q.x1 + c, 0);
      push(0, q.y1 + c);
      push(q.x1 + c, q.y1 - p.h);
      push(q.x1 - p.w, q.y1 + c);
      if (q.poly.rect) continue;
      for (const [kx, ky] of q.poly.keys) {
        const vx = kx + q.x;
        const vy = ky + q.y;
        push(vx + c, vy + c);
        push(vx - c - p.w, vy + c);
        push(vx + c, vy - c - p.h);
        push(vx - c - p.w, vy - c - p.h);
      }
      // (Its own inside corners wrapped round the placed piece's outside ones.)
      for (const [kx, ky] of p.reflex.length ? q.poly.convex : []) {
        const vx = kx + q.x;
        const vy = ky + q.y;
        for (const [ux, uy] of p.reflex) {
          push(vx - ux + c, vy - uy + c);
          push(vx - ux - c, vy - uy + c);
          push(vx - ux + c, vy - uy - c);
          push(vx - ux - c, vy - uy - c);
        }
      }
    }
    if (p.reflex.length) {
      // (Its own inside corners wrapped round placed rectangles' corners too.)
      for (const q of sheet.placed) {
        if (!q.poly.rect) continue;
        const c = gap + p.pad + SLIDE_BACKOFF;
        for (const [vx, vy] of [[q.x, q.y], [q.x1, q.y], [q.x1, q.y1], [q.x, q.y1]]) {
          for (const [ux, uy] of p.reflex) {
            push(vx - ux + c, vy - uy + c);
            push(vx - ux - c, vy - uy + c);
            push(vx - ux + c, vy - uy - c);
            push(vx - ux - c, vy - uy - c);
          }
        }
      }
    }
    // (Sorted as numbers — left-most to a tenth of a mm, then top-most, then which — far faster than by comparison.)
    const count = Math.min(xs.length, 1 << 20);
    const order = new Float64Array(count);
    for (let i = 0; i < count; i += 1) {
      order[i] = (Math.min(65535, Math.round(xs[i] * 10)) * 65536 + Math.min(65535, Math.round(ys[i] * 10))) * 1048576 + i;
    }
    order.sort();
    let lastX = NaN;
    let lastY = NaN;
    for (let k = 0; k < count; k += 1) {
      const i = order[k] % 1048576;
      const x = xs[i];
      const y = ys[i];
      if (Math.abs(x - lastX) < 1e-6 && Math.abs(y - lastY) < 1e-6) continue;
      lastX = x;
      lastY = y;
      if (!fits(sheet, p, x, y)) continue;
      // Slide it left and up until it touches.
      let cx = x;
      let cy = y;
      for (let pass = 0; pass < 6; pass += 1) {
        const left = slideRoom(sheet, p, cx, cy, true);
        cx -= left;
        const up = slideRoom(sheet, p, cx, cy, false);
        cy -= up;
        if (left < 0.01 && up < 0.01) break;
      }
      return { x: cx, y: cy };
    }
    return null;
  };

  const commit = (sheetIdx: number, p: Poly, x: number, y: number) => {
    const sheet = sheets[sheetIdx];
    const idx = sheet.placed.length;
    sheet.placed.push({ poly: p, x, y, x1: x + p.w, y1: y + p.h });
    sheet.freeArea -= p.area;
    const cx0 = Math.max(0, Math.floor(x / GRID_CELL));
    const cy0 = Math.max(0, Math.floor(y / GRID_CELL));
    const cx1 = Math.max(0, Math.floor((x + p.w) / GRID_CELL));
    const cy1 = Math.max(0, Math.floor((y + p.h) / GRID_CELL));
    for (let cy = cy0; cy <= cy1; cy += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const key = cellKey(cx, cy);
        const list = sheet.grid.get(key);
        if (list) list.push(idx);
        else sheet.grid.set(key, [idx]);
      }
    }
  };
  // Takes back the last `count` pieces put on a sheet (a set that didn't all fit).
  const rollback = (sheetIdx: number, count: number) => {
    const sheet = sheets[sheetIdx];
    for (let k = 0; k < count; k += 1) {
      const idx = sheet.placed.length - 1;
      const q = sheet.placed.pop();
      if (!q) break;
      sheet.freeArea += q.poly.area;
      out[sheetIdx].pop();
      for (const list of sheet.grid.values()) {
        if (list.length && list[list.length - 1] === idx) list.pop();
      }
    }
    sheet.lastHit = -1;
  };

  // Its best spot over its turns on one sheet: the left-most, then top-most, then the least far right and down.
  const bestOnSheet = (sheetIdx: number, polys: Array<{ poly: Poly; turn: number }>) => {
    const sheet = sheets[sheetIdx];
    let best: { poly: Poly; turn: number; x: number; y: number } | null = null;
    for (const { poly, turn } of polys) {
      const spot = bestSpot(sheet, poly);
      if (!spot) continue;
      if (
        !best ||
        spot.x < best.x - 0.01 ||
        (Math.abs(spot.x - best.x) <= 0.01 &&
          (spot.y < best.y - 0.01 ||
            (Math.abs(spot.y - best.y) <= 0.01 && spot.x + poly.w + (spot.y + poly.h) * 1e-3 < best.x + best.poly.w + (best.y + best.poly.h) * 1e-3 - 1e-6)))
      ) {
        best = { poly, turn, x: spot.x, y: spot.y };
      }
    }
    return best;
  };

  const orientations = (item: TrueShapeItem) => {
    const turns = item.turns.length ? item.turns : [0];
    const list: Array<{ poly: Poly; turn: number }> = [];
    const seenShapes = new Set<string>();
    for (const raw of turns) {
      const turn = ((raw % 4) + 4) % 4;
      const poly = polyFor(item, turn);
      // (A turn that comes out the same as one already tried — a rectangle's half turn, say — is left out.)
      const sig = `${poly.w.toFixed(3)}x${poly.h.toFixed(3)}:${poly.pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).sort().join(";")}`;
      if (seenShapes.has(sig)) continue;
      seenShapes.add(sig);
      list.push({ poly, turn });
    }
    return list;
  };

  // One item onto a sheet (an existing one if it fits, else a new one): where it went, or null (too big for a sheet).
  const placeSingle = (polys: Array<{ poly: Poly; turn: number }>, key: string, onlySheet?: number) => {
    const area = Math.min(...polys.map((o) => o.poly.area));
    const tryIdx = (idx: number) => {
      const sheet = sheets[idx];
      if (onlySheet === undefined) {
        if (sheet.failed.has(key) || area > sheet.freeArea + 1e-6) return null;
        const blocked = (o: { poly: Poly }) => {
          const solid = o.poly.solid;
          return Boolean(solid) && sheet.failedBoxes.some(([fw, fh]) => fw <= solid!.w + 1e-6 && fh <= solid!.h + 1e-6);
        };
        if (polys.every(blocked)) return null;
      }
      const best = bestOnSheet(idx, polys);
      if (!best) {
        if (onlySheet === undefined) {
          sheet.failed.add(key);
          for (const o of polys) if (o.poly.rect) sheet.failedBoxes.push([o.poly.w, o.poly.h]);
        }
        return null;
      }
      commit(idx, best.poly, best.x, best.y);
      return { sheet: idx, x: best.x, y: best.y, turn: best.turn };
    };
    if (onlySheet !== undefined) return tryIdx(onlySheet);
    for (let idx = 0; idx < sheets.length; idx += 1) {
      const got = tryIdx(idx);
      if (got) return got;
    }
    if (!polys.some((o) => o.poly.w <= W + TOL && o.poly.h <= H + TOL)) return null;
    const idx = newSheet();
    return tryIdx(idx);
  };

  units.forEach((unit, unitIdx) => {
    if (!unit.items.length) return;
    if (unit.locked) {
      const block: TrueShapeItem = { w: unit.locked.w, h: unit.locked.h, outline: null, pad: 0, turns: [0], shapeKey: `__locked_${unit.locked.w}x${unit.locked.h}` };
      const got = placeSingle(orientations(block), block.shapeKey);
      if (!got) return;
      unit.items.forEach((_, itemIdx) => {
        const offset = unit.locked?.offsets[itemIdx] ?? { x: 0, y: 0 };
        out[got.sheet].push({ unit: unitIdx, item: itemIdx, x: got.x + offset.x, y: got.y + offset.y, turn: 0 });
      });
      return;
    }
    if (unit.items.length === 1) {
      const item = unit.items[0];
      const got = placeSingle(orientations(item), item.shapeKey);
      if (got) out[got.sheet].push({ unit: unitIdx, item: 0, x: got.x, y: got.y, turn: got.turn });
      return;
    }
    // A set: all of it on the same sheet — the first it all fits on, else a new one (with as much of it as fits).
    const itemPolys = unit.items.map((item) => orientations(item));
    const trySheet = (idx: number) => {
      let placedCount = 0;
      for (let k = 0; k < unit.items.length; k += 1) {
        const got = placeSingle(itemPolys[k], unit.items[k].shapeKey, idx);
        if (!got) {
          rollback(idx, placedCount);
          return false;
        }
        out[idx].push({ unit: unitIdx, item: k, x: got.x, y: got.y, turn: got.turn });
        placedCount += 1;
      }
      return true;
    };
    for (let idx = 0; idx < sheets.length; idx += 1) if (trySheet(idx)) return;
    const idx = newSheet();
    if (trySheet(idx)) return;
    for (let k = 0; k < unit.items.length; k += 1) {
      const got = placeSingle(itemPolys[k], unit.items[k].shapeKey, idx);
      if (got) out[idx].push({ unit: unitIdx, item: k, x: got.x, y: got.y, turn: got.turn });
    }
  });

  return out.filter((sheet) => sheet.length > 0);
}
