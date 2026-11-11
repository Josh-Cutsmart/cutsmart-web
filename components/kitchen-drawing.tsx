"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  ArrowUpFromLine,
  Box,
  Check,
  ChevronDown,
  Eraser,
  Eye,
  EyeOff,
  Grid3x3,
  Hand,
  Home,
  Link2Off,
  Magnet,
  Maximize,
  MousePointer2,
  Move3d,
  Orbit as OrbitIcon,
  PanelBottom,
  PanelTop,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Ruler,
  Scaling,
  Scan,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { GlassDropdown } from "@/components/glass-dropdown";
import { GlassSwitch, Segmented } from "@/components/settings-ui";
import { undoDrawingStep } from "@/lib/drawing-undo";
import { useFloatingNotice } from "@/components/floating-notice";
import { mergeKitchenDrawing } from "@/lib/drawing-merge";
import { glassShineStyle } from "@/lib/glass-shine";
import { useView3dGestures } from "@/lib/use-view-3d-gestures";
import {
  cabinetEdgeRoles,
  cabinetModelFaces,
  cabinetSettings,
  cabinetViewProjector,
  cachedCustomCabinetModel,
  mixCabinetColor,
  projectCabinetFaces,
  type CabinetModel,
  type CabinetPrism,
  type CabinetView,
} from "@/lib/cutlist-cabinet-shape";
import { shapeGeometry, type CutlistShape } from "@/lib/cutlist-shape";
import { turnCabinetView } from "@/components/cutlist-cabinet-3d";

// Set out as a CAD program's window: a toolbar of tools across the top (Select, Move, Rotate, Extrude, Measure, the view,
// what's shown), the library down the left, a view cube, and a status bar under the drawing. The view stays where it is
// as things are dropped or changed — only Fit or Home moves it.
//
// Drawing (Planning › Drawing) — a kitchen, saved with the project (its drawings/kitchen doc, as it's changed). The
// production cutlist's pieces in a library down the left — each at its board's thickness (Board Settings) — dropped onto
// a kitchen drawn in 3D.
//
// - A front (a door, a drawer bank, doors linked or ×2) dropped on the floor starts a cabinet — an existing one (kept
//   from the old kitchen: just new fronts) — its width and height worked out from the fronts and the project's gaps
//   (General › Gap allowances): the gap between doors between every front — half of it at each end of the cabinet, so
//   the next cabinet's fronts are a gap away, the whole of it at an end next to a panel (a panel can't leave one).
//   Dropped on the middle of a cabinet, it goes in with the fronts there; dropped by its side, it's a new cabinet beside
//   it.
// - A cabinet from the cutlist (Cabinetry) is a new one: dropped in at its own size, drawn as its pieces (any of them can
//   be left off), with its sub parts on it. Fronts dropped onto it go on it.
// - Whatever's dropped goes on the face it's dropped on: off a side face, that side; on a front (or a top), the side of it
//   the pointer's nearer — and on nothing, right where it's pointed. A custom cabinet locks on by its end and turns the
//   run round its corner.
// - A cabinet or fronts dropped on a tall panel (or a tall cabinet): on its top half, up as an overhead — its top on that
//   one's top, its back on that one's back; on its bottom half, down on the floor beside it.
// - Each piece's options, at the top of its panel: Base or Wall, Benchtop (an under-bench cabinet's on, an overhead's and a
//   tall one's off, any of them either way), Kick, Fronts, Show in drawing, Lock position.
// - An overhead run off anything — a cabinet, fronts, a panel, something tall — has its top on that one's, as it's dragged
//   and when it's let go; just dropped near one, on the nearest's. Moved up or down after, it stays there.
// - Run off a panel, a base cabinet or an overhead sits at the panel's front: its carcass in line, room left for its fronts
//   and the panel's bit proud. Back from there with the Move tool, or a corner's dot dragged onto the panel's back corner.
//   (Off a tall cabinet, an overhead's back goes on that one's back: against the wall.)
// - Rotate, on a piece on its own: dragged, or an angle typed — turned that much more about its pivot (+ anticlockwise, seen
//   from above), shown as it's typed, kept with Enter.
// - Ctrl + scroll while a piece is dragged: it turns, 45° a notch — where it goes as it would, turned that much.
// - Extrude: a face of the bench picked, then dragged or a distance typed — a side out (or in), the top up, the underneath
//   down. Each kept with the piece it's over (BenchExtrusion).
// - Measure: near a corner or an edge, locked to it — a point; in the middle of a face, that whole face. Two points: the
//   distance between them (a third: the angle at the second). Two faces, or a face and a point: the true distance between
//   them, always square. However far apart along them they are, the line of the one standing further out is carried across
//   (dashed), and it's measured at the other — from that one to that line. Not parallel: still square, to the second, from
//   the first's corner nearest it — and the angle. With Snap off (the toolbar): points anywhere, no faces, and a piece
//   dragged doesn't snap to a side it's near, or into line with a run. Anything can be moved once it's in — dragged; the cabinets after it close up.
// - Fronts line up along the cabinets' faces; a panel stands its fronts' thickness + 2mm in front of them.
// - A corner (a right-click on something, or what's picked): what's run off something turned at the joint — in (its
//   fronts towards the other's) or out, any angle — the nearest corners of its fronts and the other's kept the vertical
//   gap between doors (General › Gap allowances — as between fronts side by side) apart, whatever the angle (and the
//   cabinets clear of each other). On its own: turned about a front corner.
// - Face panel (a panel's switch): it turned in across the front, corner to corner with what it's run off — at that one's
//   front corner, whatever pivot it has. Off another face panel's far end (a corner of two): set out, not turned — its
//   back corner on that one's front corner.
// - A face panel: a false cabinet behind it (see-through, dashed), from what it's swung off to its far end, as deep and
//   high as that — short of anything in the way — so it's easier to place.
// - Move: an axis picked — along it (X), in and out (Y), up and down (Z): one of the arrows on what's picked dragged, or
//   anywhere on the drawing — and it slides that way only, the distance shown (or typed) and locked in with Enter.
// - The bench: a panel standing out past the fronts takes it — the whole run's bench out to that panel's line (its
//   face and the Panels overhang), where that's further out than the fronts' line. An edge of it clicked: its overhang
//   typed, from the face of what's under it that way (the fronts' or a panel's, a side, the back) — kept on each piece
//   that edge runs along.
// - Ctrl+Z (⌘Z): the last change undone — a press, a step back, as far back as it goes (not while typing in a box).
// - Pivots: each piece's shown as a blue dot (the picked one's corners all, to pick from). A dot dragged onto another
//   piece's: that piece moves (turned as it is, what runs off it with it) so its corner's on the other's — both pivots
//   now; onto another of its own, or clicked: its pivot. A pivot clicked: let go — and any other on that same spot, the
//   pieces joined there. Blue is only ever a pivot that's been picked: with none, Rotate shows the corner it'll turn about
//   as a blue ring.
// - A gap (right-click a cabinet › Leave a gap): an empty space of its own width beside it — a dishwasher's, a fridge's —
//   with the bench over it or not; a piece of its own, put there (not run off it).
// - A panel dropped onto a cabinet's kick (or the kick under a face panel's false cabinet): a kick board — along it,
//   against the kick's face, up from the floor, hard to whichever end it was dropped nearer.
// - A wall cabinet dropped on its own above (or near) a base cabinet: against the wall behind it — its back on the plane of
//   that cabinet's back, turned as it is — wherever along it it's put.
// - A panel stood as the cutlist has it — its height up, its width its depth (a kick board's long side along); one with
//   no height (a width and a depth) lies flat — its width along the run, its depth front to back. Turn it swaps them /
//   stands it up.
// - The picked piece: a dot at all its corners, top and bottom — and every piece's, while one's being dragged; a panel's
//   corner dragged onto an overhead's bottom one goes up to its underside. Otherwise only a pivot that's been picked shows.
// - An overhead cabinet (or a wall panel) dropped in: its top in line with the overhead it's run off (or the nearest one) — lifted or
//   dropped to it; the first keeps its bottom where overheads start.
// - A piece taken out (Remove, or Delete): the sub parts that came in with it go too — all of it back in the library.
// - A cabinet made from fronts: as deep as a real cabinet it's dropped beside (Cabinetry) — else, overhead, its depth asked
//   for as it's dropped (its back kept where it is); editable after.
// - A Cabinetry cabinet dropped onto a cabinet made from fronts: put in behind them — the real cabinet, at its size, the
//   fronts kept.
// - The bench: one top over each run, its corners filled in where it's turned in — no joins — running past the fronts'
//   faces by the Benchtop settings' Fronts overhang the whole length of the run (over the panels too, in line), and past a
//   panel's end, at the end of a run, by its Panels one. Never into anything taller beside it: each bit of it only over
//   its own.
// Drawn as a custom piece's 3D is (lib/cutlist-cabinet-shape.ts — each panel a box in its real thickness, turned, moved
// and zoomed the same way), at a whole kitchen's scale. Only the drawing's own — nothing in it changes the cutlist.

export type KitchenFront = { id: string; name: string; height: number; width: number; thicknessMm: number; color: string };
export type KitchenUnit = {
  id: string;
  name: string;
  partType: string;
  // fronts: a door or drawer front, or several that go in together — a bank (one above the other, top to bottom) or
  // doors linked or ×2 (side by side); cabinet: a Cabinetry row, at its size (its sub parts — subUnits — on it as it's
  // dropped in); custom: a custom cabinet (its shape — it turns the run at its ends); panel: an end or filler panel;
  // other: listed, not placed.
  kind: "fronts" | "cabinet" | "custom" | "panel" | "other";
  layout: "side" | "stack";
  fronts: KitchenFront[];
  height: number;
  width: number;
  depth: number;
  thicknessMm: number;
  shape?: CutlistShape;
  // A wall cabinet (Cabinetry's Base / Wall).
  wall: boolean;
  // A Cabinetry one's pieces, as its cutlist makes them: a top or two rails, and how many shelves of each.
  cabinetry?: { fullTop: boolean; fixedShelves: number; adjustableShelves: number };
  subUnits: string[];
  quantity: number;
  room: string;
  color: string;
};
export type KitchenGaps = {
  // Between doors / panels side by side, and its tall cabinets' one.
  doorGap: number;
  tallDoorGap: number;
  // Between drawers stacked.
  drawerGap: number;
  // From under the bench to the top of a door or drawer — and a tall or wall cabinet's top of door to its top (with or
  // without top scribers, as the project's set).
  benchGap: number;
  tallTopGap: number;
  baseCabHeight: number;
  tallCabHeight: number;
  // Its cabinets' kicks' height — the project's Foot Height (Production › Cabinetry). None: KICK_MM.
  kickHeight?: number;
};

type Level = "base" | "wall";
type Vec = [number, number];
// Where it is: on its own (its frame's origin and turn), or run off a side of something (left / right — or a custom
// cabinet's end, "e<edge>") — turned at the joint by `turn` (radians; a corner), if it is, about the pivot of what it's
// run off (its corner at the joint, if none's picked — the front turned in, the back turned out); kept where the turn
// left it (`rel`: from where it'd sit straight — its frame's origin, in that frame, and its turn), so a pivot picked
// after doesn't move it.
// (`low`: an overhead's — at its bottom corner, not its top; the same corner on the plan.)
type Pivot = { x: 0 | 1; y: 0 | 1; low?: boolean };
type Placement =
  | { kind: "free"; x: number; y: number; a: number }
  // (face: a panel set as a face panel — turned in across the front at the corner it's run off, corner to corner.)
  | { kind: "attach"; to: string; side: string; turn?: number; rel?: { x: number; y: number; a: number }; face?: boolean };
type KitchenItem = {
  id: string;
  level: Level;
  // box: a cabinet — an existing one, worked out from its fronts, or a Cabinetry one at its size (unitId); custom: a
  // custom cabinet; panel; gap: a space left empty (gapMm wide — the bench over it, gapBench, or not).
  kind: "box" | "custom" | "panel" | "gap";
  gapMm?: number;
  gapBench?: boolean;
  // Its pivot: the corner of it what's run off it turns about — and it turns about, on its own (kept till it's changed).
  pivot?: Pivot;
  // Moved up (or down, below 0) from where it'd sit (mm).
  lift?: number;
  // Its bench's overhangs, set by hand (an edge clicked): from the face of what's under it that way (mm).
  benchOver?: Partial<Record<BenchEdge, number>>;
  // A cabinet made from fronts: how deep it is (mm) — not set, the usual for its level.
  depthMm?: number;
  unitId?: string;
  // A box's fronts (units): side by side, or one above the other — or, put where they were dropped (above, below or
  // beside another), in columns: `cols`, left to right, each top to bottom (`fronts`: all of them).
  layout: "side" | "stack";
  fronts: string[];
  cols?: string[][];
  at: Placement;
  // A panel: what kind it is — worked out from its height (auto), or set: under the bench (its top the cabinets', the
  // bench over it), tall (up from the floor), or a wall one (its top the wall cabinets').
  panelKind?: PanelKind;
  // A panel stood the other way round from how it'd be laid by itself (its height and width swapped).
  turned?: boolean;
  // Its options (not set: as goes with what it is — hasBench, hasKick). A panel's bench: only ever off.
  benchOn?: boolean;
  kickOn?: boolean;
  frontsOn?: boolean;
  // Not to be dragged, moved, turned or removed (what it's run off, moved, still takes it along).
  locked?: boolean;
};
type PanelKind = "auto" | "base" | "tall" | "wall";
// Its plan frame — a box's or a panel's origin the left end of its front line, x along it, y towards the front (the
// carcass behind it, its fronts in front); a custom cabinet's, its shape's own (y down the drawing: the front).
type Frame = { o: Vec; a: number };
type Socket = { id: string; p: Vec; n: Vec; f: Vec };
type ItemSize = {
  width: number;
  height: number;
  depth: number;
  z0: number;
  tall: boolean;
  frontT: number;
  padL: number;
  padR: number;
  g: number;
  topGap: number;
  working: string[];
  // A panel under the bench (the bench runs over it), and the kind it's taken as.
  bench?: boolean;
  panelAs?: Exclude<PanelKind, "auto">;
};
type DropTarget =
  // (place: beside or above / below one of its fronts — that front's column and row, and which side.)
  | { kind: "into"; itemId: string; place?: { col: number; row: number; side: "above" | "below" | "left" | "right" }; behind?: boolean }
  // (insert: what was on that side — it moves along, onto the far side of what's dropped.)
  // (turn: at its joint there — what keeps a piece that's moved turned the way it was.)
  // (lift, rel: where it sits on what it's run off, when that's set for it — a tall panel's top or bottom.)
  | { kind: "attach"; to: string; side: string; insert?: string; turn?: number; lift?: number; rel?: { x: number; y: number; a: number } }
  // (aligned: put in line with the run beside it — its front on theirs, turned as they are.)
  | { kind: "free"; x: number; y: number; a: number; aligned?: boolean; wall?: boolean };
// A Cabinetry one's pieces left off, by its unit — kept off till they're ticked back on.
type OffPieces = Record<string, string[]>;
// A face of the bench extruded (the Extrude tool): a side out (dist < 0: cut in) — its edge a to b, and which way's out, in
// the frame of the piece it's kept with (`anchor`, what it moves with) — or the top up, the underneath down.
type BenchExtrusion = { id: string; anchor: string; kind: "side" | "top" | "bottom"; a?: Vec; b?: Vec; n?: Vec; dist: number };
type DrawTool = "select" | "move" | "rotate" | "extrude" | "measure";
// A face clicked for measuring: its corners, which way it looks, and the point on it that was clicked. (Just a point, being
// measured square to a face: that one corner, looking the way the face does.)
type MeasureFace = { key: string; points: Array<[number, number, number]>; n: [number, number, number]; at: [number, number, number] };
// A face of the bench picked, for extruding: its points as they are, and the same as a BenchExtrusion's.
type BenchFace = { key: string; points: Array<[number, number, number]>; anchor: string; kind: "side" | "top" | "bottom"; a?: Vec; b?: Vec; n?: Vec };
type Point3 = [number, number, number];
// What can be hidden from the drawing (the Show menu).
type DrawLayer = "base" | "wall" | "fronts" | "bench" | "kicks" | "floor";
// How far the bench runs past the fronts' faces (the whole run), and past a panel's end (mm).
type BenchSettings = { fronts: number; panels: number };
const DEFAULT_BENCH: BenchSettings = { fronts: 20, panels: 20 };
const HOME_VIEW: CabinetView = { yaw: -0.45, pitch: 0.32 };

const KICK_MM = 150;
// A kick's height: the project's Foot Height, or KICK_MM without one.
const kickOf = (gaps: KitchenGaps) => (gaps.kickHeight && gaps.kickHeight > 0 ? gaps.kickHeight : KICK_MM);
// How far a cabinet's kick sits back from its front.
const KICK_SETBACK_MM = 60;
// Where a face panel's false cabinet runs, in the frame of what it's swung off: from that one's side to the panel's far
// end (lo–hi along it), back to the panel's back face.
function faceSpan(panel: KitchenItem, pf: Frame, psz: ItemSize, rf: Frame, rs: ItemSize): { lo: number; hi: number; back: number } {
  const along = rot(rf.a, [1, 0]);
  const out = rot(rf.a, [0, 1]);
  const front = psz.frontT + PANEL_PROUD_MM;
  const pts = rect(0, front - psz.depth, psz.width, front).map((q) => {
    const wq = toWorld(pf, q);
    return [dot(sub(wq, rf.o), along), dot(sub(wq, rf.o), out)] as Vec;
  });
  const dir = panel.at.kind === "attach" && panel.at.side === "left" ? -1 : 1;
  const near = dir > 0 ? rs.width : 0;
  const far = dir > 0 ? Math.max(...pts.map((q) => q[0])) : Math.min(...pts.map((q) => q[0]));
  return { lo: Math.min(near, far), hi: Math.max(near, far), back: Math.min(...pts.map((q) => q[1])) };
}
// A panel on a cabinet's kick, hard to its left end or its right.
const isKickSide = (side: string) => side === "kick-left" || side === "kick-right";
const BENCH_MM = 33;
const BASE_DEPTH = 560;
const WALL_DEPTH = 320;
const WALL_GAP_MM = 600;
const TALL_MIN_MM = 1400;
const RAIL_DEPTH_MM = 100;
// Dropped (or moved) this close to a free side of something (mm, to where it'd be): run off it.
// How near (px on the screen) the pointer must be to a free side, over nothing, for a piece to snap to it — and to a
// thin panel's edge, over something else. So it's the same however far it's zoomed.
const SNAP_PX = 26;
const THIN_SNAP_PX = 14;
const PANEL_PROUD_MM = 2;
// A panel up to this much taller than the cabinet beside it is still one under the bench (its top the cabinet's, what's
// over going down past the bottom); taller than that, it's a tall one.
const UNDER_BENCH_EXTRA_MM = 200;
const CARCASS = "#EDE7DF";
const BENCH = "#9AA3AE";
const GHOST = "#2563EB";
const GHOST_ID = "__ghost";

// ---- Plan maths.
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
const perp = (a: Vec): Vec => [-a[1], a[0]];
const len = (a: Vec) => Math.hypot(a[0], a[1]);
const unit = (a: Vec): Vec => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const rot = (a: number, v: Vec): Vec => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
const angleOf = (v: Vec) => Math.atan2(v[1], v[0]);
const toWorld = (f: Frame, p: Vec): Vec => add(f.o, rot(f.a, p));
const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

// How far apart two convex plans are (mm) — less than 0: overlapping (by about that much).
function polyGap(a: Vec[], b: Vec[]): number {
  let sep = -Infinity;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ]) {
    for (let i = 0; i < p.length; i += 1) {
      const n = unit(perp(sub(p[(i + 1) % p.length], p[i])));
      const pp = p.map((v) => dot(v, n));
      const qq = q.map((v) => dot(v, n));
      sep = Math.max(sep, Math.min(...qq) - Math.max(...pp), Math.min(...pp) - Math.max(...qq));
    }
  }
  if (sep <= 0) return sep;
  const toSegment = (v: Vec, s0: Vec, s1: Vec) => {
    const e = sub(s1, s0);
    const t = Math.max(0, Math.min(1, dot(sub(v, s0), e) / Math.max(1e-9, dot(e, e))));
    return len(sub(v, add(s0, mul(e, t))));
  };
  let d = Infinity;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ]) {
    for (const v of p) for (let i = 0; i < q.length; i += 1) d = Math.min(d, toSegment(v, q[i], q[(i + 1) % q.length]));
  }
  return d;
}
// Plans put together into one outline each where they touch or overlap (the edges between them gone): every edge cut
// where it crosses another's, the pieces with nothing on their outer side kept, and joined end to end. Outer outlines
// only (a hole's left filled), each wound the way a plan's positive area goes.
const shoelace = (poly: Vec[]) => poly.reduce((sum, p, i) => sum + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0) / 2;
const cross = (a: Vec, b: Vec) => a[0] * b[1] - a[1] * b[0];
function unionOutlines(polys: Vec[][]): Vec[][] {
  const all = polys.filter((poly) => poly.length >= 3 && Math.abs(shoelace(poly)) > 1).map((poly) => (shoelace(poly) < 0 ? [...poly].reverse() : poly));
  const segments: Array<[Vec, Vec]> = [];
  all.forEach((poly, i) => {
    for (let k = 0; k < poly.length; k += 1) {
      const a = poly[k];
      const b = poly[(k + 1) % poly.length];
      const d = sub(b, a);
      const l2 = dot(d, d);
      if (l2 < 1e-8) continue;
      const cuts = [0, 1];
      all.forEach((other, j) => {
        if (j === i) return;
        for (let m = 0; m < other.length; m += 1) {
          const c = other[m];
          const e = sub(other[(m + 1) % other.length], c);
          const den = cross(d, e);
          if (Math.abs(den) < 1e-9) {
            // (Along the same line: cut where its ends are.)
            if (Math.abs(cross(sub(c, a), d)) < 1e-4 * Math.sqrt(l2)) {
              for (const q of [c, add(c, e)]) {
                const t = dot(sub(q, a), d) / l2;
                if (t > 1e-7 && t < 1 - 1e-7) cuts.push(t);
              }
            }
            continue;
          }
          const t = cross(sub(c, a), e) / den;
          const u = cross(sub(c, a), d) / den;
          if (t > 1e-7 && t < 1 - 1e-7 && u >= -1e-7 && u <= 1 + 1e-7) cuts.push(t);
        }
      });
      cuts.sort((x, y) => x - y);
      const outward = unit([d[1], -d[0]]);
      for (let q = 0; q < cuts.length - 1; q += 1) {
        if (cuts[q + 1] - cuts[q] < 1e-7) continue;
        const p0 = add(a, mul(d, cuts[q]));
        const p1 = add(a, mul(d, cuts[q + 1]));
        const out = add(mul(add(p0, p1), 0.5), mul(outward, 0.3));
        if (all.some((other, j) => j !== i && inside(out, other))) continue;
        if (segments.some(([s0, s1]) => len(sub(s0, p0)) < 0.01 && len(sub(s1, p1)) < 0.01)) continue;
        segments.push([p0, p1]);
      }
    }
  });
  return chainLoops(segments);
}
// Pieces of outline joined end to end into closed outlines — straight runs as one edge — the outer ones (each wound the
// way a plan's positive area goes).
function chainLoops(segments: Array<[Vec, Vec]>): Vec[][] {
  const used = new Array<boolean>(segments.length).fill(false);
  const loops: Vec[][] = [];
  for (let start = 0; start < segments.length; start += 1) {
    if (used[start]) continue;
    used[start] = true;
    const loop: Vec[] = [segments[start][0]];
    let end = segments[start][1];
    for (let guard = 0; guard < segments.length && len(sub(end, loop[0])) > 0.05; guard += 1) {
      let next = -1;
      let best = 0.05;
      segments.forEach(([s0], k) => {
        const d = len(sub(s0, end));
        if (!used[k] && d < best) {
          best = d;
          next = k;
        }
      });
      if (next < 0) break;
      used[next] = true;
      loop.push(segments[next][0]);
      end = segments[next][1];
    }
    // (No points along a straight edge — its side drawn as one.)
    const clean = loop.filter((p, k) => {
      const prev = loop[(k - 1 + loop.length) % loop.length];
      const next = loop[(k + 1) % loop.length];
      return Math.abs(cross(sub(p, prev), sub(next, p))) > 1e-3 * len(sub(p, prev)) * len(sub(next, p)) + 1e-9;
    });
    if (clean.length >= 3 && shoelace(clean) > 1) loops.push(clean);
  }
  return loops;
}

// A plan with others taken out of it — what's left, as outlines: its edges kept where they're not in any of them, theirs
// where they're in it (and not in another), joined up. (One wholly inside it isn't cut out — no holes.)
function differenceOutlines(a: Vec[], cutters: Vec[][]): Vec[][] {
  const base = shoelace(a) < 0 ? [...a].reverse() : a;
  const cuts = cutters.filter((c) => c.length >= 3 && Math.abs(shoelace(c)) > 1).map((c) => (shoelace(c) < 0 ? [...c].reverse() : c));
  if (!cuts.length) return [base];
  const all = [base, ...cuts];
  const segments: Array<[Vec, Vec]> = [];
  all.forEach((poly, i) => {
    for (let k = 0; k < poly.length; k += 1) {
      const a0 = poly[k];
      const d = sub(poly[(k + 1) % poly.length], a0);
      const l2 = dot(d, d);
      if (l2 < 1e-8) continue;
      const ts = [0, 1];
      all.forEach((other, j) => {
        if (j === i) return;
        for (let m = 0; m < other.length; m += 1) {
          const c = other[m];
          const e = sub(other[(m + 1) % other.length], c);
          const den = cross(d, e);
          if (Math.abs(den) < 1e-9) {
            if (Math.abs(cross(sub(c, a0), d)) < 1e-4 * Math.sqrt(l2)) {
              for (const q of [c, add(c, e)]) {
                const t = dot(sub(q, a0), d) / l2;
                if (t > 1e-7 && t < 1 - 1e-7) ts.push(t);
              }
            }
            continue;
          }
          const t = cross(sub(c, a0), e) / den;
          const uu = cross(sub(c, a0), d) / den;
          if (t > 1e-7 && t < 1 - 1e-7 && uu >= -1e-7 && uu <= 1 + 1e-7) ts.push(t);
        }
      });
      ts.sort((x, y) => x - y);
      const left = unit([-d[1], d[0]]);
      for (let q = 0; q < ts.length - 1; q += 1) {
        if (ts[q + 1] - ts[q] < 1e-7) continue;
        const p0 = add(a0, mul(d, ts[q]));
        const p1 = add(a0, mul(d, ts[q + 1]));
        const mid = mul(add(p0, p1), 0.5);
        if (i === 0) {
          // (Its own edge: kept where what's just inside it isn't cut away.)
          const inner = add(mid, mul(left, 0.3));
          if (!cuts.some((c) => inside(inner, c))) segments.push([p0, p1]);
        } else {
          // (A cutter's edge: kept, turned round, where what's just outside it is left of the plan.)
          const outer = add(mid, mul(left, -0.3));
          if (inside(outer, base) && !cuts.some((c, j) => j !== i - 1 && inside(outer, c))) segments.push([p1, p0]);
        }
      }
    }
  });
  return chainLoops(segments);
}

// The nearest two corners of two plans, how far apart (mm).
function cornerGap(a: Vec[], b: Vec[]): number {
  let d = Infinity;
  for (const p of a) for (const q of b) d = Math.min(d, len(sub(p, q)));
  return d;
}
// Which way a corner turns in (the fronts towards each other) at a side facing n with its front f: +1 a turn the positive
// way, else -1.
const insideSign = (n: Vec, f: Vec) => (dot(perp(n), f) > 0 ? 1 : -1);

// A Cabinetry one's pieces, as its cutlist row makes them.
export function kitchenCabinetryPieces(u: KitchenUnit): Array<{ key: string; name: string }> {
  const c = u.cabinetry ?? { fullTop: u.wall, fixedShelves: 0, adjustableShelves: 0 };
  return [
    c.fullTop ? { key: "top", name: "Top" } : { key: "rail", name: "Rails (2)" },
    { key: "bottom", name: "Bottom" },
    { key: "left_side", name: "Left Side" },
    { key: "right_side", name: "Right Side" },
    { key: "back", name: "Back" },
    ...(c.fixedShelves ? [{ key: "fixed_shelf", name: c.fixedShelves > 1 ? `Fixed Shelves (${c.fixedShelves})` : "Fixed Shelf" }] : []),
    ...(c.adjustableShelves ? [{ key: "adjustable_shelf", name: c.adjustableShelves > 1 ? `Adjustable Shelves (${c.adjustableShelves})` : "Adjustable Shelf" }] : []),
  ];
}

// A custom cabinet's ends — what runs off it: each End edge's corner at its doors (b), the way out of it (n) and from
// its back to its front along it (f), in the shape's own mm.
type CustomEnd = { edge: number; b: Vec; n: Vec; f: Vec };
const endsCache = new WeakMap<CutlistShape, CustomEnd[]>();
function customEnds(shape: CutlistShape): CustomEnd[] {
  const cached = endsCache.get(shape);
  if (cached) return cached;
  const geometry = shapeGeometry(shape);
  const roles = cabinetEdgeRoles(shape);
  const n = geometry.edges.length;
  const ends = geometry.valid
    ? geometry.edges.flatMap((edge): CustomEnd[] => {
        if (roles[edge.index] !== "end" || edge.curve) return [];
        const doorsAfter = roles[(edge.index + 1) % n] === "doors";
        const back: Vec = doorsAfter ? [edge.startVertex[0], edge.startVertex[1]] : [edge.endVertex[0], edge.endVertex[1]];
        const b: Vec = doorsAfter ? [edge.endVertex[0], edge.endVertex[1]] : [edge.startVertex[0], edge.startVertex[1]];
        return [{ edge: edge.index, b, n: unit([edge.normal[0], edge.normal[1]]), f: unit(sub(b, back)) }];
      })
    : [];
  endsCache.set(shape, ends);
  return ends;
}
// Which of its ends a custom cabinet locks on by, onto a side facing n with its front f: the one that keeps its front
// that way round.
function customPlug(shape: CutlistShape, n: Vec, f: Vec): CustomEnd | null {
  const ends = customEnds(shape);
  const want = Math.sign(dot(perp(mul(n, -1)), f));
  return ends.find((end) => Math.sign(dot(perp(end.n), end.f)) === want) ?? ends[0] ?? null;
}

function unitFrontSize(u: KitchenUnit, g: number, dg: number) {
  const fronts = u.fronts;
  if (!fronts.length) return { width: 0, height: 0 };
  return u.layout === "stack"
    ? { width: Math.max(...fronts.map((f) => f.width)), height: fronts.reduce((s, f) => s + f.height, 0) + (fronts.length - 1) * dg }
    : { width: fronts.reduce((s, f) => s + f.width, 0) + (fronts.length - 1) * g, height: Math.max(...fronts.map((f) => f.height)) };
}

const wallZ0 = (gaps: KitchenGaps) => kickOf(gaps) + gaps.baseCabHeight + BENCH_MM + WALL_GAP_MM;
// An existing cabinet: one made from its fronts, not a Cabinetry one.
const isExisting = (item: KitchenItem) => item.kind === "box" && !item.unitId;

// A box's fronts in columns (left to right, each top to bottom): as put, else side by side (a column each) or stacked
// (one column).
function colsOf(item: KitchenItem): string[][] {
  if (item.cols?.length) return item.cols.map((col) => col.slice()).filter((col) => col.length);
  if (!item.fronts.length) return [];
  return item.layout === "stack" ? [item.fronts.slice()] : item.fronts.map((id) => [id]);
}
// Its fronts set to these columns (`fronts` and `layout` kept in step).
function withCols(item: KitchenItem, cols: string[][]): KitchenItem {
  const kept = cols.map((col) => col.slice()).filter((col) => col.length);
  return { ...item, cols: kept, fronts: kept.flat(), layout: kept.length === 1 && kept[0].length > 1 ? "stack" : "side" };
}
// The columns' units, and each column's size (as wide as its widest, as high as its own stacked up).
function columnsOf(item: KitchenItem, units: Map<string, KitchenUnit>, g: number, dg: number) {
  return colsOf(item)
    .map((col) => col.map((id) => units.get(id)).filter((u): u is KitchenUnit => Boolean(u)))
    .filter((col) => col.length)
    .map((col) => {
      const sizes = col.map((u) => unitFrontSize(u, g, dg));
      return { units: col, sizes, width: Math.max(...sizes.map((sz) => sz.width)), height: sizes.reduce((sum, sz) => sum + sz.height, 0) + (col.length - 1) * dg };
    });
}

// A cabinet's bench: as set; not set, an under-bench one has one, an overhead or a tall one doesn't.
const hasBench = (item: KitchenItem, size: ItemSize) => item.benchOn ?? (item.level === "base" && !size.tall);
// Its kick: on the floor, unless it's set off.
const hasKick = (item: KitchenItem, size: ItemSize) => (item.level === "base" || size.tall) && item.kickOn !== false;

// Lying flat, or as good as: its top and bottom corners too close to tell apart.
const THIN_MM = 60;
// How high its bottom corners are: a cabinet with a kick, the floor it stands on; else its own underside.
const lowOf = (item: KitchenItem, size: ItemSize, kick = KICK_MM) =>
  (item.kind === "box" || item.kind === "custom") && hasKick(item, size) ? size.z0 - kick : size.z0;

// A cabinet's size from what's in it (or the cutlist's, a Cabinetry one) — and the sums that make it, to show.
function boxSize(item: KitchenItem, units: Map<string, KitchenUnit>, gaps: KitchenGaps, panelLeft: boolean, panelRight: boolean): ItemSize {
  const own = item.unitId ? units.get(item.unitId) : undefined;
  const fronts = item.fronts.map((id) => units.get(id)).filter((u): u is KitchenUnit => Boolean(u));
  const all = fronts.flatMap((u) => u.fronts);
  const tall = own ? own.height >= TALL_MIN_MM : all.some((f) => f.height >= TALL_MIN_MM);
  const g = tall ? gaps.tallDoorGap : gaps.doorGap;
  const dg = gaps.drawerGap;
  // (A wall one has no bench over it: its top's gap the tall cabinets' — with or without top scribers.)
  const topGap = tall || item.level === "wall" ? gaps.tallTopGap : gaps.benchGap;
  const padL = panelLeft ? g : g / 2;
  const padR = panelRight ? g : g / 2;
  const frontT = all.length ? Math.max(...all.map((f) => f.thicknessMm)) : 18;
  const wall = item.level === "wall" && !tall;
  const z0 = wall ? wallZ0(gaps) : kickOf(gaps);
  const depth = own?.depth || item.depthMm || (wall ? WALL_DEPTH : BASE_DEPTH);
  const base = { tall, g, topGap, padL, padR, frontT, z0, depth };
  const panelNote = panelLeft || panelRight ? [`A full ${g} gap at the end next to the panel — a panel can't leave one.`] : [];
  if (own) {
    return { ...base, width: own.width, height: own.height, working: [`${own.name || "Cabinet"}: ${own.width} wide × ${own.height} high × ${depth} deep, from the cutlist`] };
  }
  if (!fronts.length) {
    return { ...base, width: 450, height: tall ? gaps.tallCabHeight : wall ? 720 : gaps.baseCabHeight, working: ["No fronts yet — drag one onto it."] };
  }
  const topLabel = tall ? "to the top" : wall ? "at the top" : "under the bench";
  // (Its columns side by side — the gap between doors between them — each its fronts stacked, the gap between drawers
  // between those; as wide as they are, as high as its highest.)
  const columns = columnsOf(item, units, g, dg);
  const widths = columns.flatMap((c) => (c.units.length === 1 && c.units[0].layout === "side" ? c.units[0].fronts.map((f) => f.width) : [c.width]));
  const fronted = columns.reduce((sum, c) => sum + c.width, 0) + (columns.length - 1) * g;
  const highest = columns.reduce((best, c) => (c.height > best.height ? c : best), columns[0]);
  const heights = highest.units.flatMap((u, i) => (u.layout === "stack" ? u.fronts.map((f) => f.height) : [highest.sizes[i].height]));
  return {
    ...base,
    width: fronted + padL + padR,
    height: highest.height + topGap,
    working: [
      `Width: ${widths.join(" + ")}${widths.length > 1 ? ` + ${widths.length - 1} × ${g} between` : ""} + ${padL} + ${padR} at the ends = ${fronted + padL + padR}`,
      `Height: ${heights.join(" + ")}${heights.length > 1 ? ` + ${heights.length - 1} × ${dg} between` : ""} + ${topGap} ${topLabel} = ${highest.height + topGap}`,
      ...panelNote,
    ],
  };
}

// A panel swung round to a face panel (a quarter turn at its joint) — and which way its face looks once it's round, in
// its own frame: +1 its right side, -1 its left.
// (One set as a face panel off another's far end — the second of a corner made of two — sits corner to corner with it,
// not turned: not a face panel itself.)
const isFacePanel = (item: KitchenItem) =>
  item.kind === "panel" &&
  item.at.kind === "attach" &&
  (item.at.face ? item.at.side !== "end" : Math.abs(Math.abs(item.at.turn ?? 0) - Math.PI / 2) < (5 * Math.PI) / 180);
const faceOutOf = (item: KitchenItem) => (item.at.kind === "attach" && item.at.side === "left" ? -1 : 1);

// Its plan as far as its corners go — a box's, a panel's or a gap's: left to right, back to the face of its fronts (a
// panel's face), in its own frame.
// On its own: turned about its pivot (its front left, if none's picked) — and what runs off it, with it.
const ownPivotOf = (item: KitchenItem): Pivot => item.pivot ?? { x: 0, y: 1 };
function footprintOf(x: KitchenItem, size: ItemSize): { x0: number; x1: number; y0: number; y1: number } | null {
  if (x.kind === "custom") return null;
  const front = x.kind === "panel" ? size.frontT + PANEL_PROUD_MM : x.kind === "gap" || x.fronts.length ? size.frontT : 0;
  return { x0: 0, x1: size.width, y0: x.kind === "panel" ? front - size.depth : -size.depth, y1: front };
}
const footprintCorner = (fp: { x0: number; x1: number; y0: number; y1: number }, c: Pivot): Vec => [c.x ? fp.x1 : fp.x0, c.y ? fp.y1 : fp.y0];

// Its sides (a box's or a panel's) or ends (a custom cabinet's), in its own frame. A face panel: its side against what
// it's swung off, and its far end — run on from in line with the cabinets' front (`size`: where that is).
function localSockets(item: KitchenItem, width: number, units: Map<string, KitchenUnit>, size?: ItemSize): Socket[] {
  if (item.kind === "custom") {
    const shape = item.unitId ? units.get(item.unitId)?.shape : undefined;
    return shape ? customEnds(shape).map((end) => ({ id: `e${end.edge}`, p: end.b, n: end.n, f: end.f })) : [];
  }
  if (isFacePanel(item)) {
    const out = faceOutOf(item);
    const front = (size?.frontT ?? 18) + PANEL_PROUD_MM;
    const back = front - (size?.depth ?? 0);
    const against: Socket = out > 0 ? { id: "left", p: [0, 0], n: [-1, 0], f: [0, 1] } : { id: "right", p: [width, 0], n: [1, 0], f: [0, 1] };
    return [against, { id: "end", p: [out > 0 ? width - front : front, back], n: [0, -1], f: [out, 0] }];
  }
  return [
    { id: "left", p: [0, 0], n: [-1, 0], f: [0, 1] },
    { id: "right", p: [width, 0], n: [1, 0], f: [0, 1] },
  ];
}
// The side of it that goes against a side facing n (front f): a box's left, if it runs on the way n goes, else its right
// — a custom cabinet's end that keeps its front round the right way.
function plugFor(item: KitchenItem, n: Vec, f: Vec, units: Map<string, KitchenUnit>): string {
  if (item.kind === "custom") {
    const shape = item.unitId ? units.get(item.unitId)?.shape : undefined;
    const end = shape ? customPlug(shape, n, f) : null;
    return end ? `e${end.edge}` : "";
  }
  return dot(perp(n), f) > 0 ? "left" : "right";
}
// Where it goes, run off a side (world).
function placeOn(item: KitchenItem, size: ItemSize, socket: Socket, units: Map<string, KitchenUnit>): Frame {
  const { p, n, f } = socket;
  if (item.kind === "custom") {
    const shape = item.unitId ? units.get(item.unitId)?.shape : undefined;
    const end = shape ? customPlug(shape, n, f) : null;
    if (!end) return { o: p, a: angleOf(n) };
    const a = angleOf(mul(n, -1)) - angleOf(end.n);
    return { o: sub(p, rot(a, end.b)), a };
  }
  if (dot(perp(n), f) > 0) return { o: p, a: angleOf(n) };
  return { o: add(p, mul(n, size.width)), a: angleOf(mul(n, -1)) };
}
// Its middle, in its own frame.
function localCentre(item: KitchenItem, size: ItemSize, units: Map<string, KitchenUnit>): Vec {
  if (item.kind === "custom") {
    const u = item.unitId ? units.get(item.unitId) : undefined;
    if (!u?.shape) return [0, 0];
    const b = cachedCustomCabinetModel(u.shape, u.thicknessMm).bounds;
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  }
  if (item.kind === "panel") return [size.width / 2, size.frontT + PANEL_PROUD_MM - size.depth / 2];
  return [size.width / 2, -size.depth / 2];
}

type Laid = {
  sizes: Map<string, ItemSize>;
  frames: Map<string, Frame>;
  sockets: Map<string, Socket[]>;
  // The side of each that's against what it's run off.
  plug: Map<string, string>;
};

// Everything's size and where it is: what's next to what first (a cabinet's ends next to a panel take the whole gap; a
// panel takes its cabinet's front thickness and top), then each one's frame — run off its side, or on its own.
function layoutKitchen(items: KitchenItem[], units: Map<string, KitchenUnit>, gaps: KitchenGaps): Laid {
  const byId = new Map(items.map((item) => [item.id, item]));
  const plug = new Map<string, string>();
  const beside = new Map<string, { left?: string; right?: string }>();
  const note = (id: string, side: string, other: string) => {
    if (side !== "left" && side !== "right") return;
    beside.set(id, { ...beside.get(id), [side]: other });
  };
  for (const item of items) {
    if (item.at.kind !== "attach") continue;
    const parent = byId.get(item.at.to);
    const side = item.at.side;
    const socket = parent ? localSockets(parent, 0, units).find((s) => s.id === side) : undefined;
    if (!parent || !socket) continue;
    const plugSide = plugFor(item, socket.n, socket.f, units);
    plug.set(item.id, plugSide);
    note(item.id, plugSide, parent.id);
    note(parent.id, socket.id, item.id);
  }
  const isPanel = (id?: string) => Boolean(id && byId.get(id)?.kind === "panel");
  const sizes = new Map<string, ItemSize>();
  for (const item of items) {
    if (item.kind !== "box") continue;
    const next = beside.get(item.id) ?? {};
    sizes.set(item.id, boxSize(item, units, gaps, isPanel(next.left), isPanel(next.right)));
  }
  for (const item of items) {
    if (item.kind !== "gap") continue;
    // (As deep and high as what's beside it.)
    const next = beside.get(item.id) ?? {};
    const nb = (next.left ? sizes.get(next.left) : undefined) ?? (next.right ? sizes.get(next.right) : undefined);
    const wall = item.level === "wall";
    const width = Math.max(1, Math.round(item.gapMm ?? 600));
    const z0 = nb && !nb.tall ? nb.z0 : wall ? wallZ0(gaps) : kickOf(gaps);
    const height = nb && !nb.tall ? nb.height : wall ? 720 : gaps.baseCabHeight;
    sizes.set(item.id, {
      width,
      height,
      depth: nb?.depth ?? (wall ? WALL_DEPTH : BASE_DEPTH),
      z0,
      tall: false,
      frontT: nb?.frontT ?? 18,
      padL: 0,
      padR: 0,
      g: gaps.doorGap,
      topGap: 0,
      bench: !wall && item.gapBench !== false,
      working: [`A gap ${width} wide — left empty (an appliance's space)`, !wall && item.gapBench !== false ? "The bench runs over it" : "Nothing over it"],
    });
  }
  // (The under-bench cabinets' top — the one most of them have, their doors' top gap and all: what a panel with no
  // cabinet beside it sits flush with.)
  const baseTops = items
    .filter((i) => i.kind === "box" && i.level === "base")
    .map((i) => sizes.get(i.id))
    .filter((sz): sz is ItemSize => Boolean(sz) && !sz?.tall)
    .map((sz) => Math.round(sz.z0 + sz.height));
  const runTop = baseTops.length
    ? Number(Object.entries(baseTops.reduce<Record<string, number>>((acc, z) => ({ ...acc, [z]: (acc[z] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]))[0][0])
    : kickOf(gaps) + gaps.baseCabHeight;
  for (const item of items) {
    const u = item.unitId ? units.get(item.unitId) : undefined;
    if (item.kind === "custom") {
      const shape = u?.shape;
      const b = shape ? cachedCustomCabinetModel(shape, u.thicknessMm, gaps.doorGap).bounds : null;
      sizes.set(item.id, {
        width: b ? b.maxX - b.minX : 600,
        height: shape ? cabinetSettings(shape).height : 720,
        depth: b ? b.maxY - b.minY : 600,
        z0: item.level === "wall" ? wallZ0(gaps) : kickOf(gaps),
        tall: false,
        frontT: u?.thicknessMm ?? 18,
        padL: 0,
        padR: 0,
        g: gaps.doorGap,
        topGap: 0,
        working: [`${u?.name || "Custom cabinet"}: its own shape, from the cutlist`],
      });
    } else if (item.kind === "panel") {
      const next = beside.get(item.id) ?? {};
      const nb = (next.left ? sizes.get(next.left) : undefined) ?? (next.right ? sizes.get(next.right) : undefined);
      const frontT = nb?.frontT ?? 18;
      // (Its top the cabinet's top — any more of it going down past the bottom — unless it's a good deal taller: a tall
      // one, up from the floor. A wall one's top, the wall cabinet's.)
      // (Its top as it is — lifted or dropped, if it's been.)
      const nbId = next.left && sizes.get(next.left) ? next.left : next.right;
      const nbTop = nb ? nb.z0 + nb.height + (nbId ? byId.get(nbId)?.lift ?? 0 : 0) : undefined;
      // (Bench height: from a cabinet on the floor beside it — not an overhead beside it, whose top's no bench's.)
      const onFloor = items.find((i) => {
        if (i.level !== "base" || i.kind === "panel" || !sizes.has(i.id)) return false;
        const off = (a: KitchenItem, b: KitchenItem) => a.at.kind === "attach" && a.at.to === b.id && (a.at.side === "left" || a.at.side === "right");
        return off(i, item) || off(item, i);
      });
      const floorSize = onFloor ? sizes.get(onFloor.id) : undefined;
      const baseTop = floorSize && !floorSize.tall ? floorSize.z0 + floorSize.height + (onFloor?.lift ?? 0) : runTop;
      // (Which way up: as the cutlist has it — its height up, its width its depth (along what it's run off); a kick
      // board, its long side along. No height — a width and a depth: lying flat, its width along the run, its depth front
      // to back, its thickness up. Turned, stood the other way round.)
      const onKick = item.at.kind === "attach" && isKickSide(item.at.side);
      const flat = !((u?.height ?? 0) > 0) && (u?.width ?? 0) > 0 && (u?.depth ?? 0) > 0 && !onKick;
      const lying = flat && !item.turned;
      const dims: Vec = flat ? [u?.width ?? 0, u?.depth ?? 0] : [u?.height || 720, u?.width || 560];
      const upright: Vec = onKick ? [Math.min(...dims), Math.max(...dims)] : dims;
      const [height, panelDepth] = lying ? [u?.thicknessMm ?? 18, dims[1]] : item.turned && !flat ? [upright[1], upright[0]] : upright;
      const as: Exclude<PanelKind, "auto"> = onKick
        ? "base"
        : item.panelKind && item.panelKind !== "auto"
          ? item.panelKind
          : item.level === "wall"
            ? "wall"
            : height <= baseTop + UNDER_BENCH_EXTRA_MM
              ? "base"
              : "tall";
      const top =
        as === "tall"
          ? height
          : as === "wall"
            ? nbTop !== undefined && item.level === "wall" && (nb?.tall || (nbId ? byId.get(nbId)?.level : undefined) === "wall")
              ? nbTop
              : wallZ0(gaps) + Math.min(height, 720)
            : baseTop;
      const kindLabel = as === "base" ? "Under the bench" : as === "tall" ? "Tall — up from the floor" : "Wall — its top the wall cabinets'";
      // (Its top where it goes — flush with the cabinets' — and never through the floor: a little taller than under the
      // bench, what'd go below it cut off. A kick board: up from the floor, no bench over it.)
      const z0 = onKick ? 0 : Math.max(0, top - height);
      const shown = onKick || lying ? height : Math.min(height, top - z0);
      sizes.set(item.id, {
        width: lying ? dims[0] : u?.thicknessMm ?? 18,
        height: shown,
        depth: panelDepth,
        z0,
        tall: as === "tall",
        bench: as === "base" && !onKick && !lying && item.benchOn !== false,
        panelAs: as,
        frontT,
        padL: 0,
        padR: 0,
        g: gaps.doorGap,
        topGap: 0,
        working: [
          lying
            ? `${u?.name || "Panel"}: lying flat — ${dims[0]} wide × ${dims[1]} deep, ${u?.thicknessMm ?? 18}mm thick`
            : `${u?.name || "Panel"}: ${height} high × ${panelDepth} ${onKick ? "long" : "deep"}, ${u?.thicknessMm ?? 18}mm${item.turned ? " (turned)" : ""}`,
          `${kindLabel}${item.panelKind && item.panelKind !== "auto" ? " (set)" : ""}`,
          `Its face ${frontT} + ${PANEL_PROUD_MM} in front of the cabinet's`,
        ],
      });
    }
  }
  // (Its carcass, panel and fronts as plans, where it'd be.)
  const plansOf = (it: KitchenItem, f: Frame): { solids: Vec[][]; doors: Vec[][] } => {
    const s = sizes.get(it.id);
    if (!s || it.kind === "custom") return { solids: [], doors: [] };
    const w = (poly: Vec[]) => poly.map((p) => toWorld(f, p));
    if (it.kind === "panel") {
      const front = s.frontT + PANEL_PROUD_MM;
      return { solids: [w(rect(0, front - s.depth, s.width, front))], doors: [] };
    }
    return {
      solids: [w(rect(0, -s.depth, s.width, 0))],
      doors: boxFronts(it, s, units, gaps).map((fr) => w(rect(fr.x0, 0, fr.x1, Math.max(3, fr.front.thicknessMm)))),
    };
  };
  // A corner: swung about its pivot — a corner of what it's run off (as set; else the one at the joint: its front turned
  // in, its back turned out) — its own corner there held on it (one on the far side: swung round it as it is). About
  // the front corner at the joint, fronts on both: the corner of the other's last front (its face's, turned in — its
  // back's, turned out), its own first front's corner started the vertical gap between doors on from it — so those two
  // corners stay that far apart, whatever the angle. A panel swung right round to the front about that corner — a face
  // panel — its face kept a panel's distance out. A custom cabinet (no corners): turned about the joint, then slid clear.
  const cornered = (it: KitchenItem, parent: KitchenItem, pf: Frame, f0: Frame, socket: Socket, plug: string, by: number): Frame => {
    const joint = socket.p;
    const run = socket.n;
    const theirs = plansOf(parent, pf);
    // (The vertical gap between doors — the same as between fronts side by side; a tall cabinet's, for one.)
    const g = Math.max(sizes.get(it.id)?.g ?? gaps.doorGap, sizes.get(parent.id)?.g ?? gaps.doorGap);
    const fits = (f: Frame, frontsApart: number) => {
      const mine = plansOf(it, f);
      for (const m of [...mine.solids, ...mine.doors]) {
        for (const t of [...theirs.solids, ...theirs.doors]) {
          const fronts = mine.doors.includes(m) && theirs.doors.includes(t);
          if (polyGap(m, t) < (fronts ? frontsApart : -0.5) || (fronts && cornerGap(m, t) < g - 0.001)) return false;
        }
      }
      return true;
    };
    const itSize = sizes.get(it.id);
    const parentSize = sizes.get(parent.id);
    const inward = by * insideSign(run, socket.f) > 0;
    // (The pivot: the corner of what it's run off picked on it — else its corner at the joint, its front turned in, its
    // back turned out. A face panel's far end: its face's corner, or its back's.)
    const jointCorner = (front: boolean): Pivot | null =>
      socket.id === "end" && isFacePanel(parent)
        ? { x: front === faceOutOf(parent) > 0 ? 1 : 0, y: 0 }
        : socket.id === "left" || socket.id === "right"
          ? { x: socket.id === "right" ? 1 : 0, y: front ? 1 : 0 }
          : null;
    const theirPivot: Pivot | null = it.at.kind === "attach" && it.at.face ? jointCorner(true) : parent.pivot ?? jointCorner(inward);
    const jointFront = jointCorner(true);
    const atJointFront = Boolean(theirPivot && jointFront && theirPivot.x === jointFront.x && theirPivot.y === jointFront.y);
    if (atJointFront && it.kind === "box" && parent.kind === "box" && itSize && parentSize && (plug === "left" || plug === "right") && (socket.id === "left" || socket.id === "right")) {
      const theirFronts = boxFronts(parent, parentSize, units, gaps);
      const myFronts = boxFronts(it, itSize, units, gaps);
      if (theirFronts.length && myFronts.length) {
        const edgeOf = (list: typeof theirFronts, side: string) =>
          side === "right" ? list.reduce((a, b) => (b.x1 > a.x1 ? b : a)) : list.reduce((a, b) => (b.x0 < a.x0 ? b : a));
        const theirs1 = edgeOf(theirFronts, socket.id);
        const mine1 = edgeOf(myFronts, plug);
        const pivot = toWorld(pf, [socket.id === "right" ? theirs1.x1 : theirs1.x0, inward ? Math.max(3, theirs1.front.thicknessMm) : 0]);
        const mineCorner = toWorld(f0, [plug === "right" ? mine1.x1 : mine1.x0, inward ? Math.max(3, mine1.front.thicknessMm) : 0]);
        // (Straight on from it by the gap, then turned about it.)
        const o = add(f0.o, sub(add(pivot, mul(run, g)), mineCorner));
        const frame: Frame = { o: add(pivot, rot(by, sub(o, pivot))), a: f0.a + by };
        if (fits(frame, 0)) return frame;
      }
    }
    const myPrint = itSize ? footprintOf(it, itSize) : null;
    const parentPrint = parentSize ? footprintOf(parent, parentSize) : null;
    if (theirPivot && myPrint && parentPrint) {
      // (Its corner nearest the pivot, as it sits straight — touching it, near enough — held on it; else it swings round
      // it as it is.)
      const pivot = toWorld(pf, footprintCorner(parentPrint, theirPivot));
      const mineAll = ([0, 1] as const).flatMap((x) => ([0, 1] as const).map((y) => toWorld(f0, footprintCorner(myPrint, { x, y }))));
      const mine = mineAll.reduce((best, q) => (len(sub(q, pivot)) < len(sub(best, pivot)) ? q : best));
      const o = len(sub(mine, pivot)) < 40 ? add(f0.o, sub(pivot, mine)) : f0.o;
      const swung: Frame = { o: add(pivot, rot(by, sub(o, pivot))), a: f0.a + by };
      if (atJointFront && inward && it.kind === "panel" && Math.abs(Math.abs(by) - Math.PI / 2) < (5 * Math.PI) / 180 && parentSize && parent.kind !== "panel") {
        const out = socket.f;
        const reach = Math.max(...(plansOf(it, swung).solids[0] ?? []).map((q) => dot(sub(q, pf.o), out)));
        if (Number.isFinite(reach)) return { ...swung, o: add(swung.o, mul(out, parentSize.frontT + PANEL_PROUD_MM - reach)) };
      }
      return swung;
    }
    const o = add(joint, rot(by, sub(f0.o, joint)));
    const turned = (dir: Vec, shift: number): Frame => ({ o: add(o, mul(dir, shift)), a: f0.a + by });
    if (!theirs.solids.length || it.kind === "custom") return turned(run, 0);
    const slide = (dir: Vec): Frame => {
      const at = (shift: number) => turned(dir, shift);
      let lo = 0;
      let hi = 50;
      if (fits(at(0), g)) return at(0);
      while (!fits(at(hi), g) && hi < 4000) {
        lo = hi;
        hi *= 2;
      }
      for (let i = 0; i < 30; i += 1) {
        const mid = (lo + hi) / 2;
        if (fits(at(mid), g)) hi = mid;
        else lo = mid;
      }
      return at(hi);
    };
    return slide(rot(by, run));
  };
  // (Anything moved up or down: its height from the floor, so — a panel or a gap no longer at the bench's height, no bench
  // over it.)
  for (const item of items) {
    const sz = sizes.get(item.id);
    if (sz && item.lift) sizes.set(item.id, { ...sz, z0: sz.z0 + item.lift, bench: Math.abs(item.lift) < 1 ? sz.bench : false });
  }
  const frames = new Map<string, Frame>();
  const visiting = new Set<string>();
  // A side, in the drawing. A face panel's far end: what runs off it does so in line with the front of what the panel's
  // swung off — wherever the panel itself has gone.
  const worldSocket = (owner: KitchenItem, frame: Frame, local: Socket): Socket => {
    const socket: Socket = { id: local.id, p: toWorld(frame, local.p), n: rot(frame.a, local.n), f: rot(frame.a, local.f) };
    if (local.id !== "end" || !isFacePanel(owner) || owner.at.kind !== "attach") return socket;
    const run = byId.get(owner.at.to);
    if (!run || run.kind === "custom") return socket;
    const rf = frameOf(run);
    const along = rot(rf.a, [1, 0]);
    return { ...socket, p: toWorld(rf, [dot(sub(socket.p, rf.o), along), 0]) };
  };
  const frameOf = (item: KitchenItem): Frame => {
    const done = frames.get(item.id);
    if (done) return done;
    let frame: Frame = { o: [0, 0], a: 0 };
    if (item.at.kind === "free") frame = { o: [item.at.x, item.at.y], a: item.at.a };
    else if (!visiting.has(item.id)) {
      const parent = byId.get(item.at.to);
      if (parent) {
        visiting.add(item.id);
        const pf = frameOf(parent);
        visiting.delete(item.id);
        const side = item.at.side;
        const ps = sizes.get(parent.id);
        const own = sizes.get(item.id);
        // (A kick board: along the kick — a cabinet's, or the one under a face panel's false cabinet — in that one's frame,
        // from lo to hi along it, its face kickY out.)
        const kickRun = (() => {
          if (!isKickSide(side) || !ps) return null;
          if (parent.kind === "box") return { ref: pf, lo: 0, hi: ps.width, kickY: -KICK_SETBACK_MM };
          if (parent.kind !== "panel" || !isFacePanel(parent) || parent.at.kind !== "attach") return null;
          const run = byId.get(parent.at.to);
          const rs = run ? sizes.get(run.id) : undefined;
          if (!run || !rs || run.kind === "custom") return null;
          const rf = frameOf(run);
          const span = faceSpan(parent, pf, ps, rf, rs);
          return { ref: rf, lo: span.lo, hi: span.hi, kickY: span.back - KICK_SETBACK_MM };
        })();
        if (kickRun && own) {
          // (Turned to run along it — its length along the kick, its back on the kick's face — hard to that end. Its own
          // frame: thickness across x, length down y to its front.)
          const length = own.depth;
          const front = own.frontT + PANEL_PROUD_MM;
          const x0 = side === "kick-left" ? kickRun.lo : kickRun.hi - length;
          const o: Vec = [x0 + length - front, kickRun.kickY + own.width];
          frames.set(item.id, { o: toWorld(kickRun.ref, o), a: kickRun.ref.a - Math.PI / 2 });
          return frames.get(item.id) as Frame;
        }
        const local = localSockets(parent, ps?.width ?? 0, units, ps).find((s) => s.id === side);
        const size = sizes.get(item.id);
        if (local && size) {
          const socket = worldSocket(parent, pf, local);
          frame = placeOn(item, size, socket, units);
          // (A face panel: a quarter turn in, at the corner it's run off.)
          // (Set as a face panel off another face panel's far end: corner to corner with it — set out, not turned.)
          const cornerToCorner = Boolean(item.at.face && side === "end");
          const by = item.at.face && !cornerToCorner ? (Math.PI / 2) * insideSign(local.n, local.f) : item.at.turn ?? 0;
          const rel = item.at.rel;
          // (Turned about a pivot picked for it: where that left it, from where it'd sit straight.)
          if (rel) frame = { o: toWorld(frame, [rel.x, rel.y]), a: frame.a + rel.a };
          else if (cornerToCorner) {
            // (Its back corner at the joint put on the front corner of what it's run off, there.)
            const plug = plugFor(item, local.n, local.f, units);
            const theirPrint = footprintOf(parent, sizes.get(parent.id) ?? size);
            const myPrint = footprintOf(item, size);
            const theirCorner: Pivot | null =
              side === "end" && isFacePanel(parent) ? { x: faceOutOf(parent) > 0 ? 1 : 0, y: 0 } : side === "left" || side === "right" ? { x: side === "right" ? 1 : 0, y: 1 } : null;
            if (theirPrint && myPrint && theirCorner && (plug === "left" || plug === "right")) {
              const target = toWorld(pf, footprintCorner(theirPrint, theirCorner));
              const mine = toWorld(frame, footprintCorner(myPrint, { x: plug === "right" ? 1 : 0, y: 0 }));
              frame = { o: add(frame.o, sub(target, mine)), a: frame.a };
            }
          } else if (Math.abs(by) > 1e-6) frame = cornered(item, parent, pf, frame, socket, plugFor(item, local.n, local.f, units), by);
        } else frame = pf;
      }
    }
    frames.set(item.id, frame);
    return frame;
  };
  const sockets = new Map<string, Socket[]>();
  for (const item of items) {
    const frame = frameOf(item);
    sockets.set(
      item.id,
      localSockets(item, sizes.get(item.id)?.width ?? 0, units, sizes.get(item.id)).map((s) => worldSocket(item, frame, s)),
    );
  }
  return { sizes, frames, sockets, plug };
}

// A box's fronts, in its frame: each one's left and right (along it) and bottom and top.
function boxFronts(item: KitchenItem, size: ItemSize, units: Map<string, KitchenUnit>, gaps: KitchenGaps) {
  // (Each with the column and row of the unit it's one of.)
  const out: Array<{ front: KitchenFront; x0: number; x1: number; z0: number; z1: number; col: number; row: number }> = [];
  const g = size.g;
  const dg = gaps.drawerGap;
  const putUnit = (u: KitchenUnit, x: number, top: number, w: number, col: number, row: number) => {
    if (u.layout === "stack") {
      let z = top;
      for (const front of u.fronts) {
        const fx = x + (w - front.width) / 2;
        out.push({ front, x0: fx, x1: fx + front.width, z0: z - front.height, z1: z, col, row });
        z -= front.height + dg;
      }
    } else {
      let fx = x;
      for (const front of u.fronts) {
        out.push({ front, x0: fx, x1: fx + front.width, z0: top - front.height, z1: top, col, row });
        fx += front.width + g;
      }
    }
  };
  const top = size.z0 + size.height - size.topGap;
  let x = size.padL;
  columnsOf(item, units, g, dg).forEach((column, col) => {
    let z = top;
    column.units.forEach((u, row) => {
      const sz = column.sizes[row];
      putUnit(u, x + (column.width - sz.width) / 2, z, sz.width, col, row);
      z -= sz.height + dg;
    });
    x += column.width + g;
  });
  return out;
}

// The kitchen as one model for the 3D view: the floor, and each thing in it — a cabinet's carcass (a Cabinetry one's, its
// pieces — those not left off), kick, bench and fronts (their board's real thickness), a panel, a custom cabinet's own
// parts. Each prism's `part` says what it's of ("item:<id>:…") — its colour, and what a click on it picks. (`bounds`:
// the view held still — while something's being dragged — instead of fitted round it.)
function kitchenModel(
  items: KitchenItem[],
  units: Map<string, KitchenUnit>,
  gaps: KitchenGaps,
  laid: Laid,
  off: OffPieces,
  over: BenchSettings,
  bounds?: CabinetModel["bounds"] | null,
  extrusions: BenchExtrusion[] = [],
) {
  const prisms: CabinetPrism[] = [];
  const colors = new Map<string, string>();
  const translucentParts = new Set<string>();
  const put = (part: string, polygon: Vec[], z0: number, z1: number, color: string, translucent = false) => {
    if (!(z1 > z0) || polygon.length < 3) return;
    prisms.push({ key: `${part}#${prisms.length}`, part, kind: "back", polygon, z0, z1, translucent });
    colors.set(part, color);
    if (translucent) translucentParts.add(part);
  };
  // The bench: each one's bit, put together per run (below).
  // (Each bit's strip too, where it's a straight run of bench: its frame, along it x0–x1, back y0 to front y1.)
  // (`faces`: where what's under it is, each way — its front (the fronts' face, a panel's), its back, its ends — what a
  // hand-set overhang's from; `set`: those edges set by hand.)
  type BenchStrip = { frame: Frame; x0: number; x1: number; y0: number; y1: number; faces: Record<BenchEdge, number>; set?: Partial<Record<BenchEdge, boolean>> };
  const benches: Array<{ id: string; poly: Vec[]; top: number; strip?: BenchStrip }> = [];
  const stripPoly = (st: BenchStrip) => rect(st.x0, st.y0, st.x1, st.y1).map((q) => toWorld(st.frame, q));
  const bench = (itemId: string, poly: Vec[], top: number, ghost: boolean, strip?: BenchStrip) => {
    if (ghost) {
      put(`item:${itemId}:bench`, poly, top, top + BENCH_MM, GHOST, true);
      return;
    }
    const by = items.find((i) => i.id === itemId)?.benchOver;
    if (!strip || !by) {
      benches.push({ id: itemId, poly, top, strip });
      return;
    }
    // (Its edges set by hand: out from what's under them.)
    const st: BenchStrip = { ...strip, set: {} };
    if (by.front !== undefined) [st.y1, st.set!.front] = [strip.faces.front + by.front, true];
    if (by.back !== undefined) [st.y0, st.set!.back] = [strip.faces.back - by.back, true];
    if (by.left !== undefined) [st.x0, st.set!.left] = [strip.faces.left - by.left, true];
    if (by.right !== undefined) [st.x1, st.set!.right] = [strip.faces.right + by.right, true];
    benches.push({ id: itemId, poly: stripPoly(st), top, strip: st });
  };
  // What's solid of everything but one — each cabinet's carcass and fronts, each panel, each custom cabinet's outline —
  // as plans and heights.
  // (`placeholder`: a false cabinet's — an existing one made from its fronts — not a real part: what's real cuts it, it cuts
  // nothing.)
  const solidsBut = (skip: string) =>
    items.flatMap((o): Array<{ poly: Vec[]; z0: number; z1: number; placeholder?: boolean }> => {
      if (o.id === skip || o.id === GHOST_ID || o.kind === "gap") return [];
      const of = laid.frames.get(o.id);
      const os = laid.sizes.get(o.id);
      if (!of || !os) return [];
      const wo = (poly: Vec[]) => poly.map((q) => toWorld(of, q));
      if (o.kind === "panel") {
        const f2 = os.frontT + PANEL_PROUD_MM;
        return [{ poly: wo(rect(0, f2 - os.depth, os.width, f2)), z0: os.z0, z1: os.z0 + os.height }];
      }
      if (o.kind === "custom") {
        const ou = o.unitId ? units.get(o.unitId) : undefined;
        const b = ou?.shape ? cachedCustomCabinetModel(ou.shape, ou.thicknessMm).bounds : null;
        return b ? [{ poly: wo(rect(b.minX, b.minY, b.maxX, b.maxY)), z0: os.z0, z1: os.z0 + os.height }] : [];
      }
      return [
        { poly: wo(rect(0, -os.depth, os.width, 0)), z0: os.z0, z1: os.z0 + os.height, placeholder: isExisting(o) },
        ...boxFronts(o, os, units, gaps).map((f) => ({ poly: wo(rect(f.x0, 0, f.x1, Math.max(3, f.front.thicknessMm))), z0: f.z0, z1: f.z1 })),
      ];
    });
  // A prism with what's solid of `blocks` cut out of it — banded by height, each band's plan with what's at that height
  // taken out (the cut at the first touch of each).
  const putCut = (part: string, plan: Vec[], z0: number, z1: number, color: string, translucent: boolean, blocks: Array<{ poly: Vec[]; z0: number; z1: number }>) => {
    const hits = blocks.filter((b) => b.z1 > z0 + 0.5 && b.z0 < z1 - 0.5 && polyGap(plan, b.poly) < -0.5);
    if (!hits.length) {
      put(part, plan, z0, z1, color, translucent);
      return;
    }
    const levels = Array.from(new Set([z0, z1, ...hits.flatMap((b) => [b.z0, b.z1]).filter((z) => z > z0 && z < z1)])).sort((x, y) => x - y);
    let start = levels[0];
    let key = "";
    const band = (za: number, zb: number, k: string) => {
      if (zb - za < 0.5) return;
      const cutters = hits.filter((_, bi) => k.split(",").includes(String(bi))).map((b) => b.poly);
      for (const outline of cutters.length ? differenceOutlines(plan, cutters) : [plan]) put(part, outline, za, zb, color, translucent);
    };
    for (let k = 0; k < levels.length - 1; k += 1) {
      const mid = (levels[k] + levels[k + 1]) / 2;
      const next = hits.map((b, bi) => (b.z0 < mid && b.z1 > mid ? String(bi) : "")).filter(Boolean).join(",");
      if (k > 0 && next !== key) {
        band(start, levels[k], key);
        start = levels[k];
      }
      key = next;
    }
    band(start, z1, key);
  };
  // A face panel: one swung in right round, across the front, off what it's run off — that one.
  const faceOf = (item: KitchenItem): KitchenItem | null => {
    if (item.kind !== "panel" || item.at.kind !== "attach" || (!item.at.turn && !item.at.face)) return null;
    const at = item.at;
    const parent = items.find((i) => i.id === at.to);
    const socket = parent ? localSockets(parent, 0, units).find((sk) => sk.id === at.side) : undefined;
    if (!parent || !socket || parent.kind === "custom") return null;
    if (at.face) return at.side === "end" ? null : parent;
    const turn = at.turn ?? 0;
    return turn * insideSign(socket.n, socket.f) > 0 && Math.abs(Math.abs(turn) - Math.PI / 2) < (5 * Math.PI) / 180 ? parent : null;
  };
  for (const item of items) {
    const frame = laid.frames.get(item.id);
    const size = laid.sizes.get(item.id);
    if (!frame || !size) continue;
    const ghost = item.id === GHOST_ID;
    const see = ghost || isExisting(item);
    const tint = (color: string) => (ghost ? GHOST : color);
    const w = (points: Vec[]) => points.map((p) => toWorld(frame, p));
    const id = `item:${item.id}`;
    const u = item.unitId ? units.get(item.unitId) : undefined;
    if (item.kind === "custom") {
      if (!u?.shape) continue;
      const model = cachedCustomCabinetModel(u.shape, u.thicknessMm, size.g);
      let bottom: Vec[] | null = null;
      for (const prism of model.prisms) {
        const poly = w(prism.polygon.map((p) => [p[0], p[1]] as Vec));
        if (prism.kind === "bottom") bottom = poly;
        const door = prism.kind === "door";
        put(`${id}:${door ? `front:${prism.part}` : prism.part}`, poly, size.z0 + prism.z0, size.z0 + prism.z1, tint(door ? mixCabinetColor(u.color, "#FFFFFF", 0.25) : CARCASS), ghost);
      }
      if (bottom && hasKick(item, size)) put(`${id}:kick`, bottom, 0, size.z0, tint(CARCASS), ghost);
      if (bottom && hasBench(item, size)) bench(item.id, bottom, size.z0 + size.height, ghost);
      continue;
    }
    if (item.kind === "panel") {
      const front = size.frontT + PANEL_PROUD_MM;
      const top = size.z0 + size.height;
      // (Whatever of it would go through something real — a cabinet, its fronts, another panel — chopped off; a false
      // cabinet doesn't cut it, it's cut instead.)
      putCut(`${id}:panel`, w(rect(0, front - size.depth, size.width, front)), size.z0, top, tint(u?.color ?? CARCASS), ghost, solidsBut(item.id).filter((b) => !b.placeholder));
      // (Under the bench: the bench runs over it too, as far forward as it is over the cabinets.)
      const taken = (side: string) => laid.plug.get(item.id) === side || items.some((c) => c.at.kind === "attach" && c.at.to === item.id && c.at.side === side);
      const faced = faceOf(item);
      const pf = faced ? laid.frames.get(faced.id) : undefined;
      const ps = faced ? laid.sizes.get(faced.id) : undefined;
      if (faced && pf && ps && faced.kind !== "custom") {
        // A face panel's false cabinet: behind it, from what it's swung off to its far end, back as far as that one goes,
        // as high — cut where anything real's in it (from where it first touches), left off if nothing's left of it.
        const along = rot(pf.a, [1, 0]);
        const out = rot(pf.a, [0, 1]);
        const local = (q: Vec): Vec => [dot(sub(q, pf.o), along), dot(sub(q, pf.o), out)];
        const mine = w(rect(0, front - size.depth, size.width, front)).map(local);
        const dir = item.at.kind === "attach" && item.at.side === "left" ? -1 : 1;
        const near = dir > 0 ? ps.width : 0;
        const far = dir > 0 ? Math.max(...mine.map((q) => q[0])) : Math.min(...mine.map((q) => q[0]));
        const back = Math.min(...mine.map((q) => q[1]));
        const y0 = -ps.depth;
        if ((far - near) * dir > 20 && back - y0 > 20) {
          const x0 = Math.min(near, far);
          const x1 = Math.max(near, far);
          const plan = (ya: number, yb: number) => rect(x0, ya, x1, yb).map((q) => toWorld(pf, q));
          const real = solidsBut(item.id).filter((b) => !b.placeholder);
          putCut(`${id}:backing`, plan(y0, back), ps.z0, ps.z0 + ps.height, tint(CARCASS), true, real);
          if (faced.level === "base") putCut(`${id}:backing-kick`, plan(y0, back - 60), 0, ps.z0, tint(CARCASS), true, real);
        }
      }
      if (size.bench && faced && pf && ps) {
        // (A face panel: the bench carries straight on from what it's swung off — its back, the same front line — out to
        // the panel's far end, and past it where nothing's beyond.)
        const along = rot(pf.a, [1, 0]);
        const xs = w(rect(0, front - size.depth, size.width, front)).map((q) => dot(sub(q, pf.o), along));
        const faceY = Math.max(...w(rect(0, front - size.depth, size.width, front)).map((q) => dot(sub(q, pf.o), rot(pf.a, [0, 1]))));
        const out = (item.at.kind === "attach" && item.at.side === "left") ? -1 : 1;
        const farEnd = out > 0 ? Math.max(...xs) : Math.min(...xs);
        const nearEnd = out > 0 ? ps.width : 0;
        const free = !items.some((c) => c.at.kind === "attach" && c.at.to === item.id);
        const far = farEnd + (free ? out * over.panels : 0);
        const strip: BenchStrip = {
          frame: pf,
          x0: Math.min(nearEnd, far),
          x1: Math.max(nearEnd, far),
          y0: -ps.depth,
          // (Its face and the Panels overhang — the run's fronts' line, if further, comes from the cabinets beside it.)
          y1: faceY + over.panels,
          faces: { front: faceY, back: -ps.depth, left: Math.min(nearEnd, farEnd), right: Math.max(nearEnd, farEnd) },
        };
        bench(item.id, stripPoly(strip), top, ghost, strip);
      } else if (size.bench) {
        // A panel on its own across the front of a cabinet beside it (a quarter turn to it) — a face panel all the same:
        // the bench in line with that cabinet's — its back, the fronts' line past its face — over the panel's length, and
        // past an end of it only where nothing's beyond.
        const across = (() => {
          if (item.at.kind !== "free") return null;
          const mid = toWorld(frame, [size.width / 2, front - size.depth / 2]);
          let best: { of: Frame; os: ItemSize; d: number } | null = null;
          for (const o of items) {
            if (o.kind !== "box" || o.level !== item.level || o.id === GHOST_ID) continue;
            const of = laid.frames.get(o.id);
            const os = laid.sizes.get(o.id);
            if (!of || !os) continue;
            let da = frame.a - of.a;
            while (da > Math.PI) da -= 2 * Math.PI;
            while (da <= -Math.PI) da += 2 * Math.PI;
            if (Math.abs(Math.abs(da) - Math.PI / 2) > (3 * Math.PI) / 180) continue;
            const d = len(sub(mid, toWorld(of, [os.width / 2, -os.depth / 2])));
            if (d < 2500 && (!best || d < best.d)) best = { of, os, d };
          }
          return best;
        })();
        if (across) {
          const along = rot(across.of.a, [1, 0]);
          const outward = rot(across.of.a, [0, 1]);
          const local = (q: Vec): Vec => [dot(sub(q, across.of.o), along), dot(sub(q, across.of.o), outward)];
          const mine = w(rect(0, front - size.depth, size.width, front)).map(local);
          const face = Math.max(...mine.map((q) => q[1]));
          let x0 = Math.min(...mine.map((q) => q[0]));
          let x1 = Math.max(...mine.map((q) => q[0]));
          const ends = { left: x0, right: x1 };
          const y1 = face + over.panels;
          const y0 = face - PANEL_PROUD_MM - across.os.frontT - across.os.depth;
          // (Its ends: past one only with nothing just beyond it.)
          const clear = (ex0: number, ex1: number) =>
            !items.some((o) => {
              if (o.id === item.id || o.id === GHOST_ID) return false;
              const of = laid.frames.get(o.id);
              const os = laid.sizes.get(o.id);
              if (!of || !os) return false;
              const plan = o.kind === "panel" ? rect(0, os.frontT + PANEL_PROUD_MM - os.depth, os.width, os.frontT + PANEL_PROUD_MM) : rect(0, -os.depth, os.width, 0);
              const pts = plan.map((q) => local(toWorld(of, q)));
              const ox0 = Math.min(...pts.map((q) => q[0]));
              const ox1 = Math.max(...pts.map((q) => q[0]));
              const oy0 = Math.min(...pts.map((q) => q[1]));
              const oy1 = Math.max(...pts.map((q) => q[1]));
              return ox1 > ex0 + 0.5 && ox0 < ex1 - 0.5 && oy1 > y0 + 0.5 && oy0 < y1 - 0.5;
            });
          if (clear(x0 - 30, x0)) x0 -= over.panels;
          if (clear(x1, x1 + 30)) x1 += over.panels;
          bench(item.id, rect(x0, y0, x1, y1).map((q) => toWorld(across.of, q)), top, ghost, { frame: across.of, x0, x1, y0, y1, faces: { front: face, back: y0, ...ends } });
        } else {
          // (In line with the rest — past the fronts' faces — and past its end, where nothing's beyond it.)
          const x0 = taken("left") ? 0 : -over.panels;
          const x1 = taken("right") ? size.width : size.width + over.panels;
          const strip: BenchStrip = {
            frame,
            x0,
            x1,
            y0: front - size.depth,
            // (Its face and the Panels overhang — the run's fronts' line, if further, comes from the cabinets beside it.)
            y1: front + over.panels,
            faces: { front, back: front - size.depth, left: 0, right: size.width },
          };
          bench(item.id, stripPoly(strip), top, ghost, strip);
        }
      }
      continue;
    }
    if (item.kind === "gap") {
      // (Its space, just outlined — and the bench over it, if it has one.)
      put(`${id}:gap`, w(rect(0, -size.depth, size.width, 0)), size.z0, size.z0 + size.height, tint("#CBD5E1"), true);
      if (size.bench) {
        const strip: BenchStrip = { frame, x0: 0, x1: size.width, y0: -size.depth, y1: size.frontT + over.fronts, faces: { front: size.frontT, back: -size.depth, left: 0, right: size.width } };
        bench(item.id, w(rect(strip.x0, strip.y0, strip.x1, strip.y1)), size.z0 + size.height, ghost, strip);
      }
      continue;
    }
    const top = size.z0 + size.height;
    const W = size.width;
    const D = size.depth;
    if (u) {
      // (A Cabinetry one: its pieces, as its cutlist makes them — sides the full height, the back between them, the
      // bottom and top or rails between them in front of it, the shelves spaced up it.)
      const t = Math.max(3, u.thicknessMm);
      const gone = new Set(off[u.id] ?? []);
      const piece = (key: string, plan: Vec[], z0: number, z1: number) => {
        if (!gone.has(key)) put(`${id}:${key}`, w(plan), z0, z1, tint(CARCASS), ghost);
      };
      const c = u.cabinetry ?? { fullTop: u.wall, fixedShelves: 0, adjustableShelves: 0 };
      piece("left_side", rect(0, -D, t, 0), size.z0, top);
      piece("right_side", rect(W - t, -D, W, 0), size.z0, top);
      piece("back", rect(t, -D, W - t, -D + t), size.z0, top);
      piece("bottom", rect(t, -D + t, W - t, 0), size.z0, size.z0 + t);
      if (c.fullTop) piece("top", rect(t, -D + t, W - t, 0), top - t, top);
      else {
        piece("rail", rect(t, -RAIL_DEPTH_MM, W - t, 0), top - t, top);
        piece("rail", rect(t, -D + t, W - t, -D + t + RAIL_DEPTH_MM), top - t, top);
      }
      const shelves = c.fixedShelves + c.adjustableShelves;
      const space = (size.height - 2 * t - shelves * t) / (shelves + 1);
      for (let j = 0; j < shelves; j += 1) {
        const z = size.z0 + t + (j + 1) * space + j * t;
        if (j < c.fixedShelves) piece("fixed_shelf", rect(t, -D + t, W - t, 0), z, z + t);
        else piece("adjustable_shelf", rect(t + 0.5, -D + t, W - t - 0.5, -10), z, z + t);
      }
    } else if (isExisting(item) && !ghost) {
      // (A false cabinet: cut where anything real's in it — from where it first touches; its own fronts aside.)
      putCut(`${id}:carcass`, w(rect(0, -D, W, 0)), size.z0, top, tint(CARCASS), see, solidsBut(item.id).filter((b) => !b.placeholder));
    } else put(`${id}:carcass`, w(rect(0, -D, W, 0)), size.z0, top, tint(CARCASS), see);
    // (Its kick, set back under it — and its bench.)
    if (hasKick(item, size)) put(`${id}:kick`, w(rect(0, -D, W, -KICK_SETBACK_MM)), 0, kickOf(gaps), tint(CARCASS), see);
    if (hasBench(item, size)) {
      const faces = { front: item.fronts.length ? size.frontT : 0, back: -D, left: 0, right: W };
      bench(item.id, w(rect(0, -D, W, size.frontT + over.fronts)), top, ghost, { frame, x0: 0, x1: W, y0: -D, y1: size.frontT + over.fronts, faces });
    }
    if (item.frontsOn !== false) boxFronts(item, size, units, gaps).forEach((f, index) => {
      const t = Math.max(3, f.front.thicknessMm);
      put(`${id}:front:${index}`, w(rect(f.x0, 0, f.x1, t)), f.z0, f.z1, tint(f.front.color), ghost);
    });
  }
  // A corner turned in: the bench filled in between the two — their backs carried on till they meet.
  const benchSpan = (item: KitchenItem): [number, number] | null => {
    const size = laid.sizes.get(item.id);
    if (!size) return null;
    if (item.kind === "box") return hasBench(item, size) ? [-size.depth, size.frontT + over.fronts] : null;
    if (item.level !== "base") return null;
    if (item.kind === "gap") return size.bench ? [-size.depth, size.frontT + over.fronts] : null;
    if (item.kind === "panel") return size.bench ? [size.frontT + PANEL_PROUD_MM - size.depth, size.frontT + over.fronts] : null;
    return null;
  };
  for (const item of items) {
    if (item.at.kind !== "attach" || !item.at.turn || item.id === GHOST_ID || faceOf(item)) continue;
    const at = item.at;
    const parent = items.find((i) => i.id === at.to);
    const socket = parent ? localSockets(parent, 0, units).find((sk) => sk.id === at.side) : undefined;
    const plug = laid.plug.get(item.id);
    if (!parent || !socket || (plug !== "left" && plug !== "right") || (at.side !== "left" && at.side !== "right")) continue;
    // (Turned in, up to a right angle — further round, the backs only meet a long way off.)
    if ((at.turn ?? 0) * insideSign(socket.n, socket.f) <= 0 || Math.abs(at.turn ?? 0) > Math.PI / 2 + 0.01) continue;
    const a = benchSpan(parent);
    const b = benchSpan(item);
    const pf = laid.frames.get(parent.id);
    const cf = laid.frames.get(item.id);
    const ps = laid.sizes.get(parent.id);
    const cs = laid.sizes.get(item.id);
    if (!a || !b || !pf || !cf || !ps || !cs) continue;
    const ax = at.side === "right" ? ps.width : 0;
    const bx = plug === "right" ? cs.width : 0;
    const aBack = toWorld(pf, [ax, a[0]]);
    const aFront = toWorld(pf, [ax, a[1]]);
    const bBack = toWorld(cf, [bx, b[0]]);
    const bFront = toWorld(cf, [bx, b[1]]);
    const da = rot(pf.a, [1, 0]);
    const db = rot(cf.a, [1, 0]);
    const den = cross(da, db);
    if (Math.abs(den) < 1e-6) continue;
    const meet = add(aBack, mul(da, cross(sub(bBack, aBack), db) / den));
    if (len(sub(meet, aBack)) > 3 * (ps.depth + cs.depth)) continue;
    const top = Math.max(ps.z0 + ps.height, cs.z0 + cs.height);
    // (Their fronts carried on to meet too, where that's out past both ends — the front edge square, not cut across.)
    const frontMeet = add(aFront, mul(da, cross(sub(bFront, aFront), db) / den));
    const aOut = mul(da, at.side === "right" ? 1 : -1);
    const bOut = mul(db, plug === "right" ? 1 : -1);
    const frontOut = dot(sub(frontMeet, aFront), aOut) > 1 && dot(sub(frontMeet, bFront), bOut) > 1 && len(sub(frontMeet, aFront)) < 3 * (ps.depth + cs.depth);
    benches.push({ id: item.id, poly: frontOut ? [aFront, aBack, meet, bBack, bFront, frontMeet] : [aFront, aBack, meet, bBack, bFront], top });
  }
  // One bench over each run (what's joined to what — and what its bench meets), at its highest cabinet's top.
  const runOf = new Map<string, string>();
  const root = (id: string): string => {
    const up = runOf.get(id);
    if (!up || up === id) return id;
    const r = root(up);
    runOf.set(id, r);
    return r;
  };
  const join = (a: string, b: string) => {
    const ra = root(a);
    const rb = root(b);
    if (ra !== rb) runOf.set(ra, rb);
  };
  // (A bench up on an overhead or a tall cabinet is its own: not the one at bench height it's joined to, however it's joined.)
  const benchUp = (i: KitchenItem) => {
    const sz = laid.sizes.get(i.id);
    return Boolean(sz && (i.kind === "box" || i.kind === "custom") && (i.level === "wall" || sz.tall) && hasBench(i, sz));
  };
  for (const item of items) {
    if (item.at.kind !== "attach") continue;
    const to = item.at.to;
    const parent = items.find((i) => i.id === to);
    if (parent && benchUp(parent) === benchUp(item)) join(item.id, to);
  }
  // Two benches at an angle that run into each other (their ends meeting, near enough — whatever's joined to what): the
  // corner between them filled, their backs carried on till they meet. Two that just touch: one bench.
  const toSegment = (v: Vec, s0: Vec, s1: Vec) => {
    const e = sub(s1, s0);
    const t = Math.max(0, Math.min(1, dot(sub(v, s0), e) / Math.max(1e-9, dot(e, e))));
    return len(sub(v, add(s0, mul(e, t))));
  };
  const crosses = (a0: Vec, a1: Vec, b0: Vec, b1: Vec) => {
    const d1 = cross(sub(a1, a0), sub(b0, a0));
    const d2 = cross(sub(a1, a0), sub(b1, a0));
    const d3 = cross(sub(b1, b0), sub(a0, b0));
    const d4 = cross(sub(b1, b0), sub(a1, b0));
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  const strips = benches.filter((b) => b.strip);
  // (Benches that touch: one run.)
  for (let i = 0; i < strips.length; i += 1) {
    for (let j = i + 1; j < strips.length; j += 1) {
      if (strips[i].id !== strips[j].id && Math.abs(strips[i].top - strips[j].top) <= 40 && polyGap(strips[i].poly, strips[j].poly) <= 1) join(strips[i].id, strips[j].id);
    }
  }
  // A run's bench out to its furthest front line — the fronts', or a panel standing out past them (its face and the
  // Panels overhang) — along all of it that runs the same way; not where a front edge has been set by hand.
  for (const a of strips) {
    const A = a.strip as BenchStrip;
    if (A.set?.front) continue;
    const out = rot(A.frame.a, [0, 1]);
    let furthest = A.y1;
    for (const b of strips) {
      const B = b.strip as BenchStrip;
      if (b === a || root(b.id) !== root(a.id) || Math.abs(Math.sin(B.frame.a - A.frame.a)) > 0.02 || Math.cos(B.frame.a - A.frame.a) < 0) continue;
      furthest = Math.max(furthest, dot(sub(toWorld(B.frame, [0, B.y1]), A.frame.o), out));
    }
    if (furthest > A.y1 + 0.5) {
      A.y1 = furthest;
      a.poly = stripPoly(A);
    }
  }
  for (let i = 0; i < strips.length; i += 1) {
    for (let j = i + 1; j < strips.length; j += 1) {
      const A = strips[i].strip as BenchStrip;
      const B = strips[j].strip as BenchStrip;
      if (strips[i].id === strips[j].id || Math.abs(strips[i].top - strips[j].top) > 40) continue;
      if (polyGap(strips[i].poly, strips[j].poly) <= 1) join(strips[i].id, strips[j].id);
      const ax = rot(A.frame.a, [1, 0]);
      const bx = rot(B.frame.a, [1, 0]);
      if (Math.abs(cross(ax, bx)) < 0.17) continue;
      let best: { d: number; aB: Vec; aF: Vec; bB: Vec; bF: Vec; aOut: Vec; bOut: Vec } | null = null;
      for (const ea of [A.x0, A.x1]) {
        for (const eb of [B.x0, B.x1]) {
          const aB = toWorld(A.frame, [ea, A.y0]);
          const aF = toWorld(A.frame, [ea, A.y1]);
          const bB = toWorld(B.frame, [eb, B.y0]);
          const bF = toWorld(B.frame, [eb, B.y1]);
          const d = crosses(aB, aF, bB, bF) ? 0 : Math.min(toSegment(aB, bB, bF), toSegment(aF, bB, bF), toSegment(bB, aB, aF), toSegment(bF, aB, aF));
          if (!best || d < best.d) best = { d, aB, aF, bB, bF, aOut: mul(ax, ea === A.x1 ? 1 : -1), bOut: mul(bx, eb === B.x1 ? 1 : -1) };
        }
      }
      if (!best || best.d > 60) continue;
      const den = cross(ax, bx);
      const meet = add(best.aB, mul(ax, cross(sub(best.bB, best.aB), bx) / den));
      const reach = 2 * (A.y1 - A.y0 + B.y1 - B.y0);
      // (Their backs meet out past both their ends — not behind one.)
      if (len(sub(meet, best.aB)) > reach || len(sub(meet, best.bB)) > reach) continue;
      if (dot(sub(meet, best.aB), best.aOut) < -1 || dot(sub(meet, best.bB), best.bOut) < -1) continue;
      // (Their fronts carried on to meet as well, where that's out past both — the front edge kept square, in line with
      // the fronts, not cut across.)
      const frontMeet = add(best.aF, mul(ax, cross(sub(best.bF, best.aF), bx) / den));
      const frontOut = dot(sub(frontMeet, best.aF), best.aOut) > 1 && dot(sub(frontMeet, best.bF), best.bOut) > 1 && len(sub(frontMeet, best.aF)) < reach;
      const fill = frontOut ? [best.aF, best.aB, meet, best.bB, best.bF, frontMeet] : [best.aF, best.aB, meet, best.bB, best.bF];
      let tangled = false;
      for (let e1 = 0; e1 < fill.length && !tangled; e1 += 1) {
        for (let e2 = e1 + 2; e2 < fill.length && !tangled; e2 += 1) {
          if (e1 === 0 && e2 === fill.length - 1) continue;
          if (crosses(fill[e1], fill[(e1 + 1) % fill.length], fill[e2], fill[(e2 + 1) % fill.length])) tangled = true;
        }
      }
      if (tangled) continue;
      benches.push({ id: strips[i].id, poly: fill, top: Math.max(strips[i].top, strips[j].top) });
      join(strips[i].id, strips[j].id);
    }
  }
  const runs = new Map<string, { polys: Vec[][]; cuts: Vec[][]; top: number; up: number; down: number }>();
  for (const b of benches) {
    const run = runs.get(root(b.id)) ?? { polys: [], cuts: [], top: 0, up: 0, down: 0 };
    run.polys.push(b.poly);
    run.top = Math.max(run.top, b.top);
    runs.set(root(b.id), run);
  }
  // (What's been extruded, with the run of the piece each is kept with: a side's strip added or cut, the top or the
  // underneath moved. A strip reaches a touch inside the edge, so it joins on.)
  for (const e of extrusions) {
    const run = runs.get(root(e.anchor));
    const frame = laid.frames.get(e.anchor);
    if (!run || !frame) continue;
    if (e.kind === "top") run.up += e.dist;
    else if (e.kind === "bottom") run.down += e.dist;
    else if (e.a && e.b && e.n && e.dist) {
      const a = toWorld(frame, e.a);
      const b = toWorld(frame, e.b);
      const out = rot(frame.a, e.n);
      const inner = e.dist > 0 ? -0.5 : 0.5;
      const strip = [add(a, mul(out, inner)), add(b, mul(out, inner)), add(b, mul(out, e.dist)), add(a, mul(out, e.dist))];
      (e.dist > 0 ? run.polys : run.cuts).push(strip);
    }
  }
  for (const [runId, run] of runs) {
    const cutBy = run.cuts.map((poly) => (shoelace(poly) < 0 ? [...poly].reverse() : poly));
    const outlines = unionOutlines(run.polys).flatMap((outline) => (cutBy.length ? differenceOutlines(outline, cutBy) : [outline]));
    outlines.forEach((outline, k) => put(`bench:${runId}:${k}`, outline, run.top - run.down, run.top + BENCH_MM + run.up, BENCH));
  }
  // (The floor just round what's there — the view fits it — and some to start with when it's empty.)
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = 2160;
  for (const prism of prisms) {
    for (const p of prism.polygon) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    maxZ = Math.max(maxZ, prism.z1 + 150);
  }
  if (!prisms.length) {
    minX = -600;
    maxX = 1800;
    minY = -600;
    maxY = 300;
  }
  // (A good way past what's there, under its grid — it doesn't end where they do.)
  const floorMargin = 2500;
  put(
    "room:floor",
    rect(
      Math.min(minX, bounds?.minX ?? minX) - floorMargin,
      Math.min(minY, bounds?.minY ?? minY) - floorMargin,
      Math.max(maxX, bounds?.maxX ?? maxX) + floorMargin,
      Math.max(maxY, bounds?.maxY ?? maxY) + floorMargin,
    ),
    -30,
    0,
    "#E2E8F0",
  );
  const model: CabinetModel = {
    prisms,
    height: maxZ,
    thicknessMm: 18,
    bounds: bounds ?? { minX: minX - 250, minY: minY - 250, minZ: -30, maxX: maxX + 250, maxY: maxY + 450, maxZ },
  };
  // (The bench's straight runs, as they've come out — an edge clicked is matched to those it runs along.)
  const benchStrips = benches.flatMap((b) => (b.strip ? [{ id: b.id, strip: b.strip, top: b.top }] : []));
  return { model, colors, translucentParts, benchStrips };
}

function inside(point: Vec, polygon: Array<[number, number]>): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

const newId = () => Math.random().toString(36).slice(2, 9);
const itemOfPart = (part: string | null | undefined) => (part && part.startsWith("item:") ? part.split(":")[1] ?? null : null);

// A new one of a unit, on its own for now.
function itemFor(u: KitchenUnit, level: Level, id = newId()): KitchenItem {
  return {
    id,
    level,
    kind: u.kind === "custom" ? "custom" : u.kind === "panel" ? "panel" : "box",
    unitId: u.kind === "fronts" ? undefined : u.id,
    layout: u.kind === "fronts" ? u.layout : "side",
    fronts: u.kind === "fronts" ? [u.id] : [],
    at: { kind: "free", x: 0, y: 0, a: 0 },
  };
}
// What a unit goes in at, dropped where nothing says otherwise.
function levelFor(u: KitchenUnit, placing: Level): Level {
  if (u.kind === "cabinet") return u.wall ? "wall" : "base";
  if (u.kind === "custom") return u.shape && cabinetSettings(u.shape).kind === "wall" ? "wall" : "base";
  if (u.kind === "fronts" && u.fronts.some((f) => f.height >= TALL_MIN_MM)) return "base";
  return placing;
}

// Taken out of where it is: whatever ran off its far side closes up onto what it ran off (a custom cabinet's go with it)
// — turned as it was (its turn and the one taken out's, together).
function pullOut(items: KitchenItem[], id: string): KitchenItem[] {
  const item = items.find((i) => i.id === id);
  const rest = items.filter((i) => i.id !== id);
  if (!item || item.at.kind !== "attach" || item.kind === "custom") return rest;
  const at = item.at;
  let moved = false;
  return rest.map((c) => {
    if (moved || c.at.kind !== "attach" || c.at.to !== id) return c;
    moved = true;
    const turn = (at.turn ?? 0) + (c.at.turn ?? 0);
    return { ...c, at: { kind: "attach", to: at.to, side: at.side, ...(Math.abs(turn) > 1e-6 ? { turn } : {}) } };
  });
}
// It, everything run off it, and off those.
function descendants(items: KitchenItem[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      if (item.at.kind === "attach" && out.has(item.at.to) && !out.has(item.id)) {
        out.add(item.id);
        grew = true;
      }
    }
  }
  return out;
}
// A front unit put in with a cabinet's: one above the other (drawers, or the same width and not the same height), else
// beside them — decided as its second goes in.
function withFront(item: KitchenItem, u: KitchenUnit, units: Map<string, KitchenUnit>): KitchenItem {
  const cols = colsOf(item);
  const first = cols[0]?.[0] ? units.get(cols[0][0]) : undefined;
  if (!first) return withCols(item, [[u.id]]);
  const a = unitFrontSize(first, 0, 0);
  const b = unitFrontSize(u, 0, 0);
  const stacked = (first.layout === "stack" && u.layout === "stack") || (Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) > 2);
  if (stacked) cols[cols.length - 1].push(u.id);
  else cols.push([u.id]);
  return withCols(item, cols);
}
// A front put above, below or beside one of a box's fronts (that one's column and row).
function frontPlaced(item: KitchenItem, u: KitchenUnit, place: { col: number; row: number; side: "above" | "below" | "left" | "right" }): KitchenItem {
  const cols = colsOf(item);
  const col = Math.max(0, Math.min(cols.length - 1, place.col));
  if (!cols.length) return withCols(item, [[u.id]]);
  if (place.side === "left") cols.splice(col, 0, [u.id]);
  else if (place.side === "right") cols.splice(col + 1, 0, [u.id]);
  else cols[col].splice(Math.max(0, Math.min(cols[col].length, place.row + (place.side === "below" ? 1 : 0))), 0, u.id);
  return withCols(item, cols);
}
// It put where a drop says.
// An overhead where it's gone: its top on the top of what it's run off, whatever that is — a cabinet, fronts, a panel,
// something tall. Run off nothing (`nearby`: when it's just gone in, not when it's been moved) — the nearest of those's, a
// tall one only if it's right by it. Nothing about: where an overhead goes. What runs off it goes with it.
function lineUpOverhead(items: KitchenItem[], id: string, units: Map<string, KitchenUnit>, gaps: KitchenGaps, nearby: boolean): KitchenItem[] {
  const item = items.find((i) => i.id === id);
  if (!item || item.level !== "wall" || item.kind === "gap") return items;
  const laid = layoutKitchen(items, units, gaps);
  const own = laid.sizes.get(id);
  const ownAt = laid.frames.get(id);
  if (!own || !ownAt || own.tall || (item.kind === "panel" && own.panelAs !== "wall")) return items;
  const carried = descendants(items, id);
  const upHigh = (i: KitchenItem) => {
    const sz = laid.sizes.get(i.id);
    return Boolean(sz) && i.id !== id && !carried.has(i.id) && i.kind !== "gap" && (i.level === "wall" || Boolean(sz?.tall) || sz?.panelAs === "wall");
  };
  let ref: KitchenItem | undefined;
  if (item.at.kind === "attach") {
    const to = item.at.to;
    ref = items.find((i) => i.id === to && upHigh(i));
  }
  if (!ref && nearby) {
    const here = toWorld(ownAt, localCentre(item, own, units));
    let best = Infinity;
    for (const other of items) {
      const f = laid.frames.get(other.id);
      const sz = laid.sizes.get(other.id);
      if (!f || !sz || !upHigh(other)) continue;
      const d = len(sub(toWorld(f, localCentre(other, sz, units)), here));
      if (d < (sz.tall ? 1500 : 6000) && d < best) {
        best = d;
        ref = other;
      }
    }
  }
  const to = ref ? laid.sizes.get(ref.id) : undefined;
  if (!to) return items;
  const by = to.z0 + to.height - (own.z0 + own.height);
  if (Math.abs(by) <= 0.5) return items;
  // (A panel run off it follows by itself.)
  return items.map((i) => (i.id === id || (carried.has(i.id) && i.level === "wall" && i.kind !== "panel") ? { ...i, lift: (i.lift ?? 0) + by } : i));
}

function applyTarget(items: KitchenItem[], x: KitchenItem, target: DropTarget, level: Level, units: Map<string, KitchenUnit>): KitchenItem[] {
  if (target.kind === "into" && target.behind && x.unitId) {
    // (A Cabinetry cabinet behind a front-made one's fronts: it's that cabinet now — its size — the fronts kept.)
    const cab = x.unitId;
    return items.map((item) => (item.id === target.itemId ? { ...item, unitId: cab } : item));
  }
  if (target.kind === "into") {
    const u = x.fronts[0] ? units.get(x.fronts[0]) : undefined;
    const place = target.place;
    return u ? items.map((item) => (item.id === target.itemId ? (place ? frontPlaced(item, u, place) : withFront(item, u, units)) : item)) : items;
  }
  if (target.kind === "free") return [...items, { ...x, level, at: { kind: "free", x: target.x, y: target.y, a: target.a } }];
  const placed: KitchenItem = {
    ...x,
    level,
    ...(target.lift !== undefined ? { lift: target.lift || undefined } : {}),
    at: { kind: "attach", to: target.to, side: target.side, ...(target.turn ? { turn: target.turn } : {}), ...(target.rel ? { rel: target.rel } : {}) },
  };
  const next = [...items, placed];
  if (!target.insert) return next;
  // (What was there runs off its far side now.)
  const parent = items.find((i) => i.id === target.to);
  const socket = parent ? localSockets(parent, 0, units).find((s) => s.id === target.side) : undefined;
  if (!socket) return next;
  const plug = plugFor(placed, socket.n, socket.f, units);
  const far =
    placed.kind === "custom"
      ? localSockets(placed, 0, units).find((s) => s.id !== plug)?.id
      : plug === "left"
        ? "right"
        : plug === "right"
          ? "left"
          : undefined;
  if (!far) return next;
  return next.map((item) =>
    item.id === target.insert
      ? { ...item, at: { kind: "attach", to: placed.id, side: far, ...(item.at.kind === "attach" && item.at.turn ? { turn: item.at.turn } : {}) } }
      : item,
  );
}
// One moved along one of its axes — along it (x), in and out (y), up and down (z) — by `delta` mm: on its own, its
// frame moved; run off something, still run off it — set off from where it'd sit straight; up and down, lifted.
type MoveAxis = "x" | "y" | "z";
type BenchEdge = "front" | "back" | "left" | "right";
function moveBy(items: KitchenItem[], id: string, axis: MoveAxis, delta: number, units: Map<string, KitchenUnit>, gaps: KitchenGaps): KitchenItem[] {
  const item = items.find((i) => i.id === id);
  if (!item || !delta) return items;
  if (axis === "z") return items.map((i) => (i.id === id ? { ...i, lift: (i.lift ?? 0) + delta } : i));
  const f = layoutKitchen(items, units, gaps).frames.get(id);
  if (!f) return items;
  const o = add(f.o, mul(rot(f.a, axis === "x" ? [1, 0] : [0, 1]), delta));
  if (item.at.kind === "free") return items.map((i) => (i.id === id ? { ...i, at: { kind: "free", x: o[0], y: o[1], a: f.a } } : i));
  const at = item.at;
  const straight = layoutKitchen(items.map((i) => (i.id === id ? { ...i, at: { kind: "attach" as const, to: at.to, side: at.side } } : i)), units, gaps).frames.get(id);
  if (!straight) return items;
  const d = rot(-straight.a, sub(o, straight.o));
  return items.map((i) => (i.id === id ? { ...i, at: { ...at, rel: { x: d[0], y: d[1], a: f.a - straight.a } } } : i));
}
// A turn at its joint kept where it puts it now — from where it'd sit straight — so nothing changed after (a pivot
// picked, say) moves it.
function bakeTurn(items: KitchenItem[], id: string, units: Map<string, KitchenUnit>, gaps: KitchenGaps): KitchenItem[] {
  const item = items.find((i) => i.id === id);
  if (!item || item.at.kind !== "attach" || !item.at.turn) return items;
  const at = item.at;
  const straightAt = { kind: "attach" as const, to: at.to, side: at.side };
  const frameWith = (placement: Placement) => layoutKitchen(items.map((i) => (i.id === id ? { ...i, at: placement } : i)), units, gaps).frames.get(id);
  const turned = frameWith({ ...straightAt, turn: at.turn });
  const straight = frameWith(straightAt);
  if (!turned || !straight) return items;
  const d = rot(-straight.a, sub(turned.o, straight.o));
  return items.map((i) => (i.id === id ? { ...i, at: { ...straightAt, turn: at.turn, rel: { x: d[0], y: d[1], a: turned.a - straight.a } } } : i));
}

// A tool on the toolbar: an icon, its name (and key) on hovering.
const TEXT_FIELDS = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';
// Whether a key's for the box it's pressed in, not the drawing. A measurement box (MeasureBox): letters never are (it only
// takes numbers), and the rest aren't while nothing's been typed or dragged into it.
function keyIsForField(event: KeyboardEvent, letter = false) {
  const field = event.target instanceof HTMLElement ? event.target.closest(TEXT_FIELDS) : null;
  if (!field) return false;
  const box = field instanceof HTMLElement ? field.dataset.measureBox : undefined;
  if (!box) return true;
  return !letter && box === "busy";
}

// A box a measurement's typed in to finish what's under way: ready for it as soon as it's there — focused, what's in it
// highlighted — and again after the drawing's clicked or dragged on, or its number's changed by anything but typing (Enter,
// a drag). `idle`: nothing waiting in it, so the drawing's keys still work from it. `active` off: an ordinary box, that
// only highlights when it's clicked. (On a touch screen it waits to be tapped: focusing it would bring the keyboard up.)
function MeasureBox({
  idle,
  active = true,
  value,
  onChange,
  onInput,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { idle: boolean; active?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const typed = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !window.matchMedia("(pointer: fine)").matches) return;
    const ready = () => {
      ref.current?.focus({ preventScroll: true });
      ref.current?.select();
    };
    ready();
    const onUp = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      if (event.target instanceof Element && event.target.closest(TEXT_FIELDS)) return;
      window.setTimeout(() => {
        const now = document.activeElement;
        if (now && now !== ref.current && now.closest(TEXT_FIELDS)) return;
        ready();
      }, 0);
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [active]);
  useEffect(() => {
    const box = ref.current;
    if (box && active && document.activeElement === box && value !== undefined && String(value) !== typed.current) box.select();
  }, [active, value]);
  return (
    <input
      {...rest}
      ref={ref}
      value={value}
      data-measure-box={active ? (idle ? "idle" : "busy") : undefined}
      onFocus={(e) => e.target.select()}
      onBeforeInput={(e) => {
        // (Only numbers go in: a letter would otherwise wipe what's highlighted.)
        if (/[^0-9.-]/.test(e.data)) e.preventDefault();
      }}
      onChange={(e) => {
        typed.current = e.target.value.replace(/[^0-9.-]/g, "");
        onChange?.(e);
      }}
      onInput={(e) => {
        if (active && value === undefined) e.currentTarget.dataset.measureBox = "busy";
        onInput?.(e);
      }}
    />
  );
}

function ToolButton({
  icon: Icon,
  label,
  keys,
  active,
  disabled,
  small,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  keys?: string;
  active?: boolean;
  disabled?: boolean;
  small?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={keys ? `${label} (${keys})` : label}
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center justify-center rounded-[6px] border transition-colors disabled:opacity-35 ${small ? "h-[24px] w-[24px]" : "h-[30px] w-[30px]"} ${active ? "" : "border-transparent hover:bg-[var(--panel-muted)]"}`}
      style={active ? { borderColor: "var(--brand)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" } : { color: "var(--text-main)" }}
    >
      <Icon size={small ? 14 : 17} strokeWidth={1.75} />
    </button>
  );
}
// A group of tools, named under them.
function ToolGroup({ label, last, children }: { label: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex shrink-0 flex-col items-center gap-0.5 px-2 ${last ? "" : "border-r"}`} style={{ borderColor: "var(--glass-border)" }}>
      <div className="flex items-center gap-0.5">{children}</div>
      <span className="text-[9.5px] font-medium uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
    </div>
  );
}
// The view cube: which way the drawing's being looked at — a face clicked, looking at it square on.
const CUBE_FACES: Array<{ label: string; n: Point3; u: Point3; v: Point3; view: CabinetView }> = [
  { label: "FRONT", n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], view: { yaw: 0, pitch: 0 } },
  { label: "BACK", n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], view: { yaw: Math.PI, pitch: 0 } },
  { label: "RIGHT", n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], view: { yaw: -Math.PI / 2, pitch: 0 } },
  { label: "LEFT", n: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], view: { yaw: Math.PI / 2, pitch: 0 } },
  { label: "TOP", n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], view: { yaw: 0, pitch: Math.PI / 2 - 0.001 } },
];
function ViewCube({ view, onPick }: { view: CabinetView; onPick: (view: CabinetView) => void }) {
  const [cy, sy] = [Math.cos(view.yaw), Math.sin(view.yaw)];
  const [cp, sp] = [Math.cos(view.pitch), Math.sin(view.pitch)];
  const turned = (p: Point3): Point3 => {
    const x1 = p[0] * cy + p[1] * sy;
    const z1 = -p[0] * sy + p[1] * cy;
    return [x1, p[2] * cp - z1 * sp, p[2] * sp + z1 * cp];
  };
  const size = 86;
  const scale = 22;
  const at = (p: Point3): Vec => {
    const t = turned(p);
    return [size / 2 + t[0] * scale, size / 2 - t[1] * scale];
  };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }} role="group" aria-label="View cube">
      {CUBE_FACES.filter((face) => turned(face.n)[2] > 0.02).map((face) => {
        const corner = (a: number, b: number): Point3 => [0, 1, 2].map((i) => face.n[i] + a * face.u[i] + b * face.v[i]) as Point3;
        const points = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].map(at);
        const mid = at(face.n);
        return (
          <g key={face.label} onClick={() => onPick(face.view)} style={{ cursor: "pointer" }}>
            <title>{`Look at the ${face.label.toLowerCase()}`}</title>
            <polygon points={points.map((q) => q.join(",")).join(" ")} className="fill-[var(--panel-muted)] hover:fill-[var(--brand-soft)]" stroke="var(--text-muted)" strokeOpacity={0.55} strokeWidth={1} strokeLinejoin="round" />
            <text x={mid[0]} y={mid[1]} fontSize={7.5} fontWeight={500} textAnchor="middle" dominantBaseline="middle" fill="var(--text-muted)" pointerEvents="none">
              {face.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// The nearest place on a flat face to a point on its plane: the point itself, if it's on the face.
function nearestOnFace(face: Array<[number, number, number]>, n: Point3, q: Point3): Point3 {
  const minus = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot3 = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const raw = minus(face[1], face[0]);
  const size = Math.hypot(...raw) || 1;
  const u: Point3 = [raw[0] / size, raw[1] / size, raw[2] / size];
  const v: Point3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const flat = (p: Point3): Vec => [dot3(minus(p, face[0]), u), dot3(minus(p, face[0]), v)];
  const plan = face.map((p) => flat(p));
  const at = flat(q);
  if (inside(at, plan)) return q;
  let best: { p: Point3; d: number } | null = null;
  face.forEach((a, i) => {
    const b = face[(i + 1) % face.length];
    const e = minus(b, a);
    const t = Math.max(0, Math.min(1, dot3(minus(q, a), e) / Math.max(1e-9, dot3(e, e))));
    const p: Point3 = [a[0] + e[0] * t, a[1] + e[1] * t, a[2] + e[2] * t];
    const d = Math.hypot(...minus(p, q));
    if (!best || d < best.d) best = { p, d };
  });
  return best ? (best as { p: Point3; d: number }).p : q;
}

function readStored<T>(key: string, fallback: T, ok: (value: unknown) => boolean): T {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed !== null && ok(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

// What's kept of a drawing (the project's drawings/kitchen doc): what's placed where, the pieces left off, the bench.
export type KitchenDrawingData = { items: unknown[]; off: Record<string, string[]>; bench: Record<string, unknown>; extrusions: unknown[] };
const validItems = (value: unknown): KitchenItem[] =>
  Array.isArray(value)
    ? (value as KitchenItem[]).filter((item) => item && typeof item.id === "string" && item.at && Array.isArray(item.fronts))
    : [];
const validOff = (value: unknown): OffPieces => (value && typeof value === "object" && !Array.isArray(value) ? (value as OffPieces) : {});
const validExtrusions = (value: unknown): BenchExtrusion[] =>
  Array.isArray(value) ? (value as BenchExtrusion[]).filter((e) => e && typeof e.id === "string" && typeof e.anchor === "string" && Number.isFinite(e.dist)) : [];
const validBench = (value: unknown): BenchSettings =>
  value && typeof value === "object" && !Array.isArray(value) && typeof (value as BenchSettings).fronts === "number" ? { ...DEFAULT_BENCH, ...(value as BenchSettings) } : DEFAULT_BENCH;

export function KitchenDrawing({
  projectId,
  projectName,
  units,
  gaps,
  load,
  save,
  subscribe,
  readOnly = false,
  onBack,
}: {
  projectId: string;
  projectName: string;
  units: KitchenUnit[];
  gaps: KitchenGaps;
  // The project's saved drawing — `data` null: none yet; null: it couldn't be read.
  load: () => Promise<{ data: Record<string, unknown> | null } | null>;
  save: (data: KitchenDrawingData) => Promise<boolean>;
  // Someone else's changes to it, as they reach the database: the drawing as it is now, and as it was before them.
  subscribe?: (onNews: (data: Record<string, unknown>, base: Record<string, unknown> | null) => void) => () => void;
  // Can't change the project (its Production access): looked at and played with, not saved.
  readOnly?: boolean;
  onBack: () => void;
}) {
  // (Where it was kept while it was a preview, in this browser — brought over, the first time, if the project has none.)
  const storageKey = `cutsmart_kitchen_drawing_preview_v2_${projectId}`;
  const [items, setItems] = useState<KitchenItem[]>([]);
  const [offPieces, setOffPieces] = useState<OffPieces>({});
  // A face of the bench extruded.
  const [extrusions, setExtrusions] = useState<BenchExtrusion[]>([]);
  // Undo: what it was before each change (the latest last) — Ctrl+Z (⌘Z) goes back a step a press; a step back isn't
  // itself remembered, only kept for Redo (Ctrl+Y, or Ctrl+Shift+Z), till something else is changed.
  // With others in the drawing, a step only takes back what this person did (lib/drawing-undo.ts): someone else's changes
  // aren't steps here (see applyDrawingNewsRef), and a piece they've changed since is left as they made it, with a warning.
  type DrawingState = { items: KitchenItem[]; extrusions: BenchExtrusion[] };
  type DrawingStep = { before: DrawingState; after: DrawingState };
  const historyRef = useRef<DrawingStep[]>([]);
  const redoRef = useRef<DrawingStep[]>([]);
  const lastItemsRef = useRef<DrawingState>({ items, extrusions });
  const undoWarning = useFloatingNotice({ tone: "yellow", durationMs: 6000 });
  const undoingRef = useRef(false);
  useEffect(() => {
    if (lastItemsRef.current.items === items && lastItemsRef.current.extrusions === extrusions) return;
    if (!undoingRef.current) {
      historyRef.current.push({ before: lastItemsRef.current, after: { items, extrusions } });
      if (historyRef.current.length > 200) historyRef.current.shift();
      redoRef.current = [];
    }
    undoingRef.current = false;
    lastItemsRef.current = { items, extrusions };
  }, [extrusions, items]);
  const stepHistory = (from: { current: DrawingStep[] }, to: { current: DrawingStep[] }) => {
    const step = from.current.pop();
    if (!step) return false;
    const now = lastItemsRef.current;
    const result = undoDrawingStep(step, now);
    if (result.changed) {
      to.current.push({ before: now, after: { items: result.items, extrusions: result.extrusions } });
      undoingRef.current = true;
      setItems(result.items);
      setExtrusions(result.extrusions);
    }
    if (result.skipped) {
      undoWarning.show(
        result.skipped === 1
          ? "Someone else has changed this piece since, so it's been left as they made it."
          : `Someone else has changed ${result.skipped} of these pieces since, so they've been left as they made them.`,
      );
    }
    return true;
  };
  const undo = () => stepHistory(historyRef, redoRef);
  const redo = () => stepHistory(redoRef, historyRef);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.repeat) return;
      const key = event.key.toLowerCase();
      const again = key === "y" || (key === "z" && event.shiftKey);
      if (key !== "z" && !again) return;
      if (keyIsForField(event)) return;
      if (again ? redo() : undo()) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const [benchOver, setBenchOver] = useState<BenchSettings>(DEFAULT_BENCH);
  // Saved with the project: read as it opens ("loading" till then — "failed", it couldn't be: nothing saved over it),
  // then each change written a moment after it's made (and as it's left).
  const [saveState, setSaveState] = useState<"loading" | "failed" | "saved" | "saving" | "error">("loading");
  const savedJsonRef = useRef("");
  const pendingRef = useRef<{ json: string; data: KitchenDrawingData } | null>(null);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  const loadRef = useRef(load);
  useEffect(() => {
    let live = true;
    void loadRef.current().then((result) => {
      if (!live) return;
      if (!result) {
        setSaveState("failed");
        return;
      }
      let data = result.data;
      let brought = false;
      if (!data) {
        // (None saved yet: the one made here while it was a preview, if there is one.)
        const local = readStored<unknown[]>(storageKey, [], (v) => Array.isArray(v));
        if (local.length) {
          data = {
            items: local,
            off: readStored<unknown>(`${storageKey}_off`, {}, (v) => typeof v === "object"),
            bench: readStored<unknown>(`${storageKey}_bench`, DEFAULT_BENCH, (v) => typeof v === "object"),
          };
          brought = true;
        }
      }
      const next = { items: validItems(data?.items), off: validOff(data?.off), bench: validBench(data?.bench), extrusions: validExtrusions(data?.extrusions) };
      savedJsonRef.current = brought ? "" : JSON.stringify(next);
      undoingRef.current = true;
      historyRef.current = [];
      setItems(next.items);
      setOffPieces(next.off);
      setBenchOver(next.bench);
      setExtrusions(next.extrusions);
      setSaveState("saved");
    });
    return () => {
      live = false;
    };
  }, [storageKey]);
  const loaded = saveState !== "loading" && saveState !== "failed";
  const flushRef = useRef(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    setSaveState("saving");
    void saveRef.current(pending.data).then((ok) => {
      if (ok) {
        savedJsonRef.current = pending.json;
        try {
          // (Brought over: no longer needed here.)
          window.localStorage.removeItem(storageKey);
          window.localStorage.removeItem(`${storageKey}_off`);
          window.localStorage.removeItem(`${storageKey}_bench`);
        } catch {
          // (Left as it is.)
        }
      }
      setSaveState(pendingRef.current ? "saving" : ok ? "saved" : "error");
    });
  });
  useEffect(() => {
    if (!loaded || readOnly) return;
    const data: KitchenDrawingData = { items, off: offPieces, bench: benchOver, extrusions };
    const json = JSON.stringify(data);
    if (json === savedJsonRef.current) return;
    pendingRef.current = { json, data };
    const timer = window.setTimeout(() => flushRef.current(), 900);
    return () => window.clearTimeout(timer);
  }, [benchOver, extrusions, items, loaded, offPieces, readOnly]);
  // (Left, or the page going away, with a change not written yet: written now.)
  useEffect(() => {
    const flush = flushRef.current;
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [room, setRoom] = useState("All rooms");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<CabinetView>({ yaw: -0.45, pitch: 0.32 });
  const [hoverPart, setHoverPart] = useState<string | null>(null);
  const [piecesOpen, setPiecesOpen] = useState(false);
  // What a drop on the floor starts: a base cabinet or a wall one.
  const [placing, setPlacing] = useState<Level>("base");
  // Something on its way in (from the library) or being moved — where it'd go — and the view held still meanwhile.
  const [dropPreview, setDropPreview] = useState<{ unitId: string; target: DropTarget; level: Level } | null>(null);
  const [moving, setMoving] = useState<{ id: string; target: DropTarget; level: Level } | null>(null);
  const [heldBounds, setHeldBounds] = useState<CabinetModel["bounds"] | null>(null);
  // An overhead cabinet made from fronts just dropped: its depth asked for (typed).
  const [depthAsk, setDepthAsk] = useState<{ id: string; text: string } | null>(null);
  // An edge of the bench, clicked: its ends (on the plan) and height — its overhang typed in the bar for it.
  const [benchEdge, setBenchEdge] = useState<{ a: Vec; b: Vec; z: number } | null>(null);
  const [benchEdgeText, setBenchEdgeText] = useState("");
  useEffect(() => {
    if (!benchEdge) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBenchEdge(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [benchEdge]);
  // Rotate: on, a drag on the drawing turns what's picked — as it's dragged (`rotating`: its turn at its joint, or its
  // frame on its own), snapping every 45°.
  const [tool, setTool] = useState<DrawTool>("select");
  const rotateTool = tool === "rotate";
  // Move: on, a drag on the drawing slides what's picked along the axis picked — `moveDraft`: how far so far (and as
  // typed), not kept till Enter (or the tick).
  const moveTool = tool === "move";
  const [moveAxis, setMoveAxis] = useState<MoveAxis>("x");
  const [moveDraft, setMoveDraft] = useState<{ id: string; delta: number; text: string } | null>(null);
  // Extrude: the bench's face picked, how far so far (dragged, or typed — not kept till Enter), and the one under the pointer.
  const [extrude, setExtrude] = useState<{ face: BenchFace; dist: number; text: string } | null>(null);
  const [extrudeHover, setExtrudeHover] = useState<string | null>(null);
  const extrudeDragRef = useRef<{ pointerId: number; face: BenchFace; out: Vec; startPlan: Vec; startY: number; z: number; base: number } | null>(null);
  // Measure: its points so far (two, a length; three, the angle at the second) — and where the next would go.
  const [measure, setMeasure] = useState<{ points: Point3[]; done: boolean } | null>(null);
  const [measureHover, setMeasureHover] = useState<{ p: Point3; snapped: boolean; edge?: [Point3, Point3] } | null>(null);
  // Snap (on the toolbar): off, a measurement's points go anywhere, and what's dragged doesn't snap.
  const [snapOn, setSnapOn] = useState(true);
  // Measuring between faces (or a face and a point): the first, the second; and the face under the pointer.
  const [faceMeasure, setFaceMeasure] = useState<{ a: MeasureFace; b: MeasureFace | null } | null>(null);
  const [faceHover, setFaceHover] = useState<MeasureFace | null>(null);
  // Left-drag on the drawing: Orbit or Pan, on from the status bar, whatever it's over.
  const [navTool, setNavTool] = useState<"orbit" | "pan" | null>(null);
  // What's shown.
  const [hiddenLayers, setHiddenLayers] = useState<ReadonlySet<DrawLayer>>(new Set());
  const [hiddenItems, setHiddenItems] = useState<ReadonlySet<string>>(new Set());
  const [xray, setXray] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showDims, setShowDims] = useState(false);
  const [showMenuAt, setShowMenuAt] = useState<{ left: number; top: number } | null>(null);
  // The library's tabs and search; the settings panel; the properties panel folded away.
  const [leftTab, setLeftTab] = useState<"library" | "browser">("library");
  const [libSearch, setLibSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [propsFolded, setPropsFolded] = useState(false);
  const moveDragRef = useRef<{ pointerId: number; id: string; axis: MoveAxis; startPlan: Vec; startY: number; z: number; base: number; dir: Vec } | null>(null);

  const [rotating, setRotating] = useState<{ id: string; turn?: number; free?: { x: number; y: number; a: number } } | null>(null);
  const rotateRef = useRef<{ pointerId: number; id: string; pivot: Vec; z: number; last: number; total: number; base: number; frame: Frame | null } | null>(null);
  // The pivot's blue dot being dragged: by which pointer, and the corner it's over.
  // (A corner's dot dragged: whose and which, the dot it's over now, and whether it's moved — a press that doesn't is a
  // click.)
  // (`low`: one of an overhead's bottom corners — not its top.)
  type CornerRef = { id: string; corner: Pivot; low?: boolean };
  const sameRef = (a: CornerRef | null | undefined, b: CornerRef | null | undefined) =>
    (!a && !b) || Boolean(a && b && a.id === b.id && a.corner.x === b.corner.x && a.corner.y === b.corner.y && Boolean(a.low) === Boolean(b.low));
  const [pivotDrag, setPivotDrag] = useState<{ pointerId: number; from: CornerRef; over: CornerRef | null; x: number; y: number; moved: boolean; pointer?: Vec | null } | null>(null);
  // The right-click menu: on what, and where (px, in the drawing).
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const rightDownRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  // A piece dragged from the library — by the pointer (mouse, pen or finger), not the browser's own drag and drop: which
  // unit, where it was pressed, where the pointer is, and whether it's moved far enough to be a drag yet.
  type LibDrag = { unitId: string; pointerId: number; x0: number; y0: number; x: number; y: number; started: boolean };
  const [libDrag, setLibDrag] = useState<LibDrag | null>(null);
  // (Heard on the window from the press itself — not from after it's drawn, or a quick drag's let go first: the drag as
  // it stands, and the latest of what to do with it.)
  const libDragRef = useRef<LibDrag | null>(null);
  const libHandlersRef = useRef<{ move: (event: PointerEvent) => void; up: (event: PointerEvent) => void } | null>(null);

  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  // (Anything whose unit's gone from the cutlist: left out.)
  const liveItems = useMemo(() => items.filter((item) => item.kind === "box" || item.kind === "gap" || (item.unitId && unitMap.has(item.unitId))), [items, unitMap]);
  // How many of each unit are in the drawing.
  const usedCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of liveItems) {
      for (const id of item.fronts) counts.set(id, (counts.get(id) ?? 0) + 1);
      if (item.unitId) counts.set(item.unitId, (counts.get(item.unitId) ?? 0) + 1);
    }
    return counts;
  }, [liveItems]);
  const rooms = useMemo(() => ["All rooms", ...Array.from(new Set(units.map((u) => u.room).filter(Boolean)))], [units]);
  const groups = useMemo(() => {
    const byType = new Map<string, KitchenUnit[]>();
    for (const u of units) {
      if (room !== "All rooms" && u.room !== room) continue;
      if (libSearch.trim() && !`${u.name} ${u.partType}`.toLowerCase().includes(libSearch.trim().toLowerCase())) continue;
      byType.set(u.partType, [...(byType.get(u.partType) ?? []), u]);
    }
    const rank: Record<KitchenUnit["kind"], number> = { fronts: 0, cabinet: 1, custom: 2, panel: 3, other: 4 };
    return Array.from(byType.entries()).sort((a, b) => Math.min(...a[1].map((u) => rank[u.kind])) - Math.min(...b[1].map((u) => rank[u.kind])));
  }, [units, room, libSearch]);

  // Ctrl + scroll while dragging a piece: how far it's been turned. Its drop, with that: on its own, turned about its
  // middle; run off something, at its joint (not a custom cabinet, which locks on by its end).
  const [dragTurn, setDragTurn] = useState(0);
  const withDragTurn = (item: KitchenItem, target: DropTarget): DropTarget => {
    if (!dragTurn || target.kind === "into" || item.kind === "custom") return target;
    if (target.kind === "attach") return { ...target, turn: (target.turn ?? 0) + dragTurn };
    const own = layoutKitchen([{ ...item, at: { kind: "free", x: 0, y: 0, a: 0 } }], unitMap, gaps).sizes.get(item.id);
    if (!own) return target;
    const c = localCentre(item, own, unitMap);
    const mid = add([target.x, target.y], rot(target.a, c));
    const a = target.a + dragTurn;
    const o = sub(mid, rot(a, c));
    return { kind: "free", x: o[0], y: o[1], a };
  };
  // What's shown: as it is — or with what's being dropped or moved where it'd go.
  const draft = moveTool && moveDraft && moveDraft.id === selectedId ? moveDraft : null;
  // (As it is — not as it's shown while something's dragged.)
  const laidNow = useMemo(() => layoutKitchen(liveItems, unitMap, gaps), [gaps, liveItems, unitMap]);
  // Rotate: an angle typed, for a piece on its own — and where that turns it, about its pivot; not kept till Enter.
  const [rotateTyped, setRotateTyped] = useState<{ id: string; deg: number; text: string } | null>(null);
  // Someone else's changes, put onto this drawing with any changes here left as they are (mergeKitchenDrawing). Not under
  // something being moved or placed: straight after it.
  const drawingBusy = Boolean(moving || dropPreview || rotating || moveDraft || extrude || libDrag || pivotDrag);
  const latestDrawingRef = useRef<KitchenDrawingData>({ items, off: offPieces, bench: benchOver, extrusions });
  useEffect(() => {
    latestDrawingRef.current = { items, off: offPieces, bench: benchOver, extrusions };
  });
  const drawingNewsRef = useRef<{ data: Record<string, unknown>; base: Record<string, unknown> | null } | null>(null);
  const applyDrawingNewsRef = useRef(() => {});
  useEffect(() => {
    applyDrawingNewsRef.current = () => {
      const news = drawingNewsRef.current;
      if (!news || drawingBusy) return;
      drawingNewsRef.current = null;
      const local = latestDrawingRef.current as unknown as Record<string, unknown>;
      // (None saved when it was opened: as it stood then, so what's not been touched here doesn't count as changed.)
      const base = news.base ?? (savedJsonRef.current ? (JSON.parse(savedJsonRef.current) as Record<string, unknown>) : null);
      const merged = mergeKitchenDrawing(base, local, news.data);
      const next = { items: validItems(merged.items), off: validOff(merged.off), bench: validBench(merged.bench), extrusions: validExtrusions(merged.extrusions) };
      const fromServer = { items: validItems(news.data.items), off: validOff(news.data.off), bench: validBench(news.data.bench), extrusions: validExtrusions(news.data.extrusions) };
      // What's in the database now: if that's what this comes to, there's nothing to save back.
      savedJsonRef.current = JSON.stringify(fromServer);
      if (JSON.stringify(next) === JSON.stringify(local)) return;
      undoingRef.current = true;
      setItems(next.items);
      setOffPieces(next.off);
      setBenchOver(next.bench);
      setExtrusions(next.extrusions);
    };
  });
  useEffect(() => {
    applyDrawingNewsRef.current();
  }, [drawingBusy]);
  const subscribeRef = useRef(subscribe);
  useEffect(() => {
    subscribeRef.current = subscribe;
  });
  useEffect(() => {
    if (!loaded || !subscribeRef.current) return;
    return subscribeRef.current((data, base) => {
      // (A later one, before the last's been put on: the base it was put on stays.)
      drawingNewsRef.current = { data, base: drawingNewsRef.current ? drawingNewsRef.current.base : base };
      applyDrawingNewsRef.current();
    });
  }, [loaded]);
  const turnTyped = rotateTool && rotateTyped && rotateTyped.id === selectedId ? rotateTyped : null;
  const typedTurn = useMemo(() => {
    if (!turnTyped) return null;
    const item = liveItems.find((i) => i.id === turnTyped.id);
    const frame = laidNow.frames.get(turnTyped.id);
    const size_ = laidNow.sizes.get(turnTyped.id);
    const print = item && size_ ? footprintOf(item, size_) : null;
    if (!item || item.at.kind !== "free" || !frame || !print) return null;
    const pivot = toWorld(frame, footprintCorner(print, ownPivotOf(item)));
    // (The plan's y runs towards the front, so a plain + angle would look clockwise from above.)
    const by = (-turnTyped.deg * Math.PI) / 180;
    const o = add(pivot, rot(by, sub(frame.o, pivot)));
    return { id: item.id, free: { x: o[0], y: o[1], a: frame.a + by } };
  }, [laidNow, liveItems, turnTyped]);
  const shownItems = useMemo(() => {
    if (draft?.delta) return moveBy(liveItems, draft.id, moveAxis, draft.delta, unitMap, gaps);
    const turning: typeof rotating = rotating ?? typedTurn;
    if (turning) {
      return liveItems.map((item) =>
        item.id !== turning.id
          ? item
          : turning.free
            ? { ...item, at: { kind: "free" as const, ...turning.free } }
            : item.at.kind === "attach"
              ? { ...item, at: { kind: "attach" as const, to: item.at.to, side: item.at.side, turn: turning.turn } }
              : item,
      );
    }
    if (moving) {
      const item = liveItems.find((i) => i.id === moving.id);
      return item ? lineUpOverhead(applyTarget(pullOut(liveItems, moving.id), item, withDragTurn(item, moving.target), moving.level, unitMap), moving.id, unitMap, gaps, false) : liveItems;
    }
    if (dropPreview) {
      const u = unitMap.get(dropPreview.unitId);
      if (!u) return liveItems;
      const ghost = itemFor(u, dropPreview.level, GHOST_ID);
      return lineUpOverhead(applyTarget(liveItems, ghost, withDragTurn(ghost, dropPreview.target), dropPreview.level, unitMap), GHOST_ID, unitMap, gaps, true);
    }
    return liveItems;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragTurn, draft, dropPreview, gaps, liveItems, moveAxis, moving, rotating, typedTurn, unitMap]);
  const laid = useMemo(() => layoutKitchen(shownItems, unitMap, gaps), [gaps, shownItems, unitMap]);
  const selected = liveItems.find((item) => item.id === selectedId) ?? null;
  const shownExtrusions = useMemo(
    () => (extrude?.dist ? [...extrusions, { ...extrude.face, id: "__draft", dist: extrude.dist }] : extrusions),
    [extrude, extrusions],
  );
  const { model, colors, translucentParts, benchStrips } = useMemo(
    () => kitchenModel(shownItems, unitMap, gaps, laid, offPieces, benchOver, heldBounds, shownExtrusions),
    [benchOver, gaps, heldBounds, laid, offPieces, shownExtrusions, shownItems, unitMap],
  );
  // (What's been hidden, left out — it can't be clicked or dropped on either.)
  const partHidden = useMemo(() => {
    const levelOf = new Map(shownItems.map((item) => [item.id, item.level]));
    return (part: string) => {
      if (part.startsWith("room:")) return hiddenLayers.has("floor");
      if (part.startsWith("bench:")) return hiddenLayers.has("bench");
      if (hiddenLayers.has("fronts") && part.includes(":front:")) return true;
      if (hiddenLayers.has("kicks") && part.endsWith("kick")) return true;
      const id = itemOfPart(part);
      if (!id) return false;
      const level = levelOf.get(id);
      return hiddenItems.has(id) || Boolean(level && hiddenLayers.has(level));
    };
  }, [hiddenItems, hiddenLayers, shownItems]);
  const faces = useMemo(() => cabinetModelFaces(model).filter((face) => !partHidden(face.part)), [model, partHidden]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // (The drawing's box, as it's put up — watched for its size from then: not from the first effect, which can run before
  // it's there.)
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 800, height: 520 });
  useEffect(() => {
    if (!hostEl || typeof ResizeObserver === "undefined") return;
    const fit = () => setSize({ width: Math.max(200, hostEl.clientWidth), height: Math.max(200, hostEl.clientHeight) });
    const observer = new ResizeObserver(fit);
    observer.observe(hostEl);
    return () => observer.disconnect();
  }, [hostEl]);
  const projected = useMemo(() => projectCabinetFaces(model, faces, view, size), [faces, model, size, view]);

  const { attachTo, handlers, transform, zoom, resetZoom, zoomBy, cursor } = useView3dGestures({
    onTurn: (dx, dy) => setView((prev) => turnCabinetView(prev, dx, dy)),
    onTap: (x, y) => {
      if (tool === "measure") {
        const at = measurePointAt(x, y);
        const face = at ? null : measureFaceAt(x, y);
        // (A point, as what's measured to a face looking this way.)
        const asFace = (q: Point3, n: Point3, key: string): MeasureFace => ({ key, points: [q], n, at: q });
        const openFace = faceMeasure && !faceMeasure.b ? faceMeasure.a : null;
        const openPoint = measure && !measure.done && measure.points.length === 1 ? measure.points[0] : null;
        if (face) {
          setMeasure(null);
          if (openPoint) setFaceMeasure({ a: asFace(openPoint, face.n, "point"), b: face });
          else if (openFace) {
            if (openFace.key !== face.key) setFaceMeasure({ a: openFace, b: face });
          } else setFaceMeasure({ a: face, b: null });
        } else if (at) {
          if (openFace) setFaceMeasure({ a: openFace, b: asFace(at.p, openFace.n, "point") });
          else {
            setFaceMeasure(null);
            setMeasure((prev) => (!prev || prev.done ? { points: [at.p], done: false } : { points: [...prev.points, at.p], done: prev.points.length + 1 >= 3 }));
          }
        }
        return;
      }
      if (tool === "extrude") {
        if (!extrude?.dist) setExtrude(null);
        return;
      }
      setSelectedId(null);
      setBenchEdge(benchEdgeAt(x, y));
      setBenchEdgeText("");
    },
    leftTurns: navTool === "orbit",
    middlePans: true,
  });
  // A point on the screen, through to a plane — in the drawing (mm).
  function pointOnPlane(clientX: number, clientY: number, n: Point3, p0: Point3): Point3 | null {
    const point = svgPoint(clientX, clientY);
    if (!point) return null;
    const { k, centre } = cabinetViewProjector(model, view, size);
    const [cy, sy] = [Math.cos(view.yaw), Math.sin(view.yaw)];
    const [cp, sp] = [Math.cos(view.pitch), Math.sin(view.pitch)];
    const across: Point3 = [cy, sy, 0];
    const up: Point3 = [sy * sp, -cy * sp, cp];
    const towards: Point3 = [-sy * cp, cy * cp, sp];
    const x = (point[0] - size.width / 2) / k;
    const y = (size.height / 2 - point[1]) / k;
    const at = (d: number): Point3 => [0, 1, 2].map((i) => centre[i] + x * across[i] + y * up[i] + d * towards[i]) as Point3;
    const dot3 = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const facing = dot3(n, towards);
    if (Math.abs(facing) < 1e-4) return null;
    const onScreen = at(0);
    return at(dot3(n, [p0[0] - onScreen[0], p0[1] - onScreen[1], p0[2] - onScreen[2]]) / facing);
  }
  // Where a measurement's point goes, under the pointer. Snap on: a corner or the middle of an edge of the face it's over
  // (else of anything just there), or an edge, if it's near one — nothing otherwise (in the middle of a face: that face,
  // measureFaceAt). A thin face's reach is less, so the face itself can still be had. Snap off: right there, on the face
  // it's over or the floor.
  function measurePointAt(clientX: number, clientY: number): { p: Point3; snapped: boolean; edge?: [Point3, Point3] } | null {
    const point = svgPoint(clientX, clientY);
    if (!point) return null;
    let over: (typeof projected)[number] | undefined;
    for (let i = projected.length - 1; i >= 0 && !over; i -= 1) {
      if (!projected[i].part.startsWith("room:") && inside(point, projected[i].screen)) over = projected[i];
    }
    if (!snapOn) {
      const p = over ? pointOnPlane(clientX, clientY, over.normal as Point3, over.points[0] as Point3) : pointOnPlane(clientX, clientY, [0, 0, 1], [0, 0, 0]);
      return p ? { p, snapped: false } : null;
    }
    type Near = { p: Point3; d: number };
    // (Something else's corner or edge that lands within the face it's over is behind that face: not to be picked.)
    const hiddenBy = (face: (typeof projected)[number], on: Vec) => Boolean(over && face !== over && inside(on, over.screen));
    const cornerNear = (face: (typeof projected)[number], reach: number) => {
      let best: Near | null = null;
      face.points.forEach((p, i) => {
        const j = (i + 1) % face.points.length;
        const s0 = face.screen[i];
        const s1 = face.screen[j];
        const q = face.points[j];
        const options: Array<[Point3, Vec]> = [
          [[p[0], p[1], p[2]], [s0[0], s0[1]]],
          [[(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], [(s0[0] + s1[0]) / 2, (s0[1] + s1[1]) / 2]],
        ];
        for (const [at, on] of options) {
          const d = len(sub(on, point));
          if (d <= reach && !hiddenBy(face, on) && (!best || d < (best as Near).d)) best = { p: at, d };
        }
      });
      return best as Near | null;
    };
    const edgeNear = (face: (typeof projected)[number], reach: number) => {
      let best: { p: Point3; d: number; edge: [Point3, Point3] } | null = null;
      face.points.forEach((p, i) => {
        const j = (i + 1) % face.points.length;
        const s0: Vec = [face.screen[i][0], face.screen[i][1]];
        const e = sub([face.screen[j][0], face.screen[j][1]], s0);
        const t = Math.max(0, Math.min(1, dot(sub(point, s0), e) / Math.max(1e-9, dot(e, e))));
        const on = add(s0, mul(e, t));
        const d = len(sub(point, on));
        const q = face.points[j];
        if (d <= reach && !hiddenBy(face, on) && (!best || d < (best as { d: number }).d)) {
          best = { p: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t], d, edge: [p as Point3, q as Point3] };
        }
      });
      return best as { p: Point3; d: number; edge: [Point3, Point3] } | null;
    };
    // (How narrow the face it's over is, on the screen.)
    const narrow = over
      ? Math.min(
          Math.max(...over.screen.map((q) => q[0])) - Math.min(...over.screen.map((q) => q[0])),
          Math.max(...over.screen.map((q) => q[1])) - Math.min(...over.screen.map((q) => q[1])),
        ) * zoom.z
      : Infinity;
    const onFace = over ? cornerNear(over, Math.min(16, Math.max(5, narrow * 0.3)) / zoom.z) : null;
    if (onFace) return { p: onFace.p, snapped: true };
    let nearby: Near | null = null;
    for (const face of projected) {
      if (face.part.startsWith("room:")) continue;
      const hit = cornerNear(face, Math.min(10, Math.max(5, narrow * 0.3)) / zoom.z);
      if (hit && (!nearby || hit.d < nearby.d)) nearby = hit;
    }
    if (nearby) return { p: nearby.p, snapped: true };
    const edgeReach = Math.min(10, narrow * 0.2) / zoom.z;
    const onEdge = over ? edgeNear(over, edgeReach) : null;
    if (onEdge) return { p: onEdge.p, snapped: true, edge: onEdge.edge };
    let edgeBy: { p: Point3; d: number; edge: [Point3, Point3] } | null = null;
    for (const face of projected) {
      if (face.part.startsWith("room:")) continue;
      const hit = edgeNear(face, edgeReach);
      if (hit && (!edgeBy || hit.d < edgeBy.d)) edgeBy = hit;
    }
    return edgeBy ? { p: edgeBy.p, snapped: true, edge: edgeBy.edge } : null;
  }
  // The face under the pointer, for measuring from — the floor, if there's nothing else there.
  function measureFaceAt(clientX: number, clientY: number): MeasureFace | null {
    const point = svgPoint(clientX, clientY);
    if (!point || !snapOn) return null;
    let over: (typeof projected)[number] | undefined;
    for (let i = projected.length - 1; i >= 0 && !over; i -= 1) if (inside(point, projected[i].screen)) over = projected[i];
    if (!over) return null;
    const size3 = Math.hypot(over.normal[0], over.normal[1], over.normal[2]) || 1;
    const n: Point3 = [over.normal[0] / size3, over.normal[1] / size3, over.normal[2] / size3];
    const at = pointOnPlane(clientX, clientY, n, over.points[0] as Point3);
    if (!at) return null;
    return { key: over.key, points: over.points.map((q) => [q[0], q[1], q[2]] as Point3), n, at };
  }
  // The bench's face under the pointer, if it's what's in front there.
  function benchFaceAt(clientX: number, clientY: number): BenchFace | null {
    const point = svgPoint(clientX, clientY);
    if (!point) return null;
    let face: (typeof projected)[number] | undefined;
    for (let i = projected.length - 1; i >= 0 && !face; i -= 1) if (!projected[i].part.startsWith("room:") && inside(point, projected[i].screen)) face = projected[i];
    if (!face || !face.part.startsWith("bench:")) return null;
    const anchor = face.part.split(":")[1];
    const frame = laid.frames.get(anchor);
    if (!frame || anchor === GHOST_ID) return null;
    const points = face.points.map((q) => [q[0], q[1], q[2]] as [number, number, number]);
    const base = { key: face.key, points, anchor };
    if (face.normal[2] > 0.5) return { ...base, kind: "top" };
    if (face.normal[2] < -0.5) return { ...base, kind: "bottom" };
    const toLocal = (q: Vec) => rot(-frame.a, sub(q, frame.o));
    return {
      ...base,
      kind: "side",
      a: toLocal([points[0][0], points[0][1]]),
      b: toLocal([points[1][0], points[1][1]]),
      n: rot(-frame.a, [face.normal[0], face.normal[1]]),
    };
  }
  // The extrusion so far, kept — it's in the bench from here.
  const commitExtrude = () => {
    if (extrude?.dist) {
      const { anchor, kind, a, b, n } = extrude.face;
      setExtrusions((prev) => [...prev, { id: newId(), anchor, kind, a, b, n, dist: extrude.dist }]);
    }
    setExtrude(null);
  };
  // A press on the bench's face (or its arrow): dragged from here, that face out or in.
  const startExtrudeDrag = (event: ReactPointerEvent<Element>, face: BenchFace, base: number) => {
    const frame = laidNow.frames.get(face.anchor);
    if (!frame) return;
    try {
      hostRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // (Already let go.)
    }
    const z = (Math.min(...face.points.map((q) => q[2])) + Math.max(...face.points.map((q) => q[2]))) / 2;
    extrudeDragRef.current = {
      pointerId: event.pointerId,
      face,
      out: face.n ? rot(frame.a, face.n) : [0, 0],
      startPlan: planPointAt(event.clientX, event.clientY, z),
      startY: svgPoint(event.clientX, event.clientY)?.[1] ?? 0,
      z,
      base,
    };
    if (!heldBounds) setHeldBounds(model.bounds);
  };
  // The bench edge under a click: the bench face in front there — its outline's edge nearest where it was clicked (on
  // its top).
  function benchEdgeAt(clientX: number, clientY: number): { a: Vec; b: Vec; z: number } | null {
    const point = svgPoint(clientX, clientY);
    if (!point) return null;
    let face: (typeof projected)[number] | undefined;
    for (let i = projected.length - 1; i >= 0 && !face; i -= 1) if (inside(point, projected[i].screen)) face = projected[i];
    if (!face || !face.part.startsWith("bench:")) return null;
    const prism = model.prisms.find((q) => q.part === face.part);
    if (!prism) return null;
    const at = planPointAt(clientX, clientY, prism.z1);
    let best: { a: Vec; b: Vec; d: number } | null = null;
    for (let k = 0; k < prism.polygon.length; k += 1) {
      const a = prism.polygon[k] as Vec;
      const b = prism.polygon[(k + 1) % prism.polygon.length] as Vec;
      const e = sub(b, a);
      const t = Math.max(0, Math.min(1, dot(sub(at, a), e) / Math.max(1e-9, dot(e, e))));
      const d = len(sub(at, add(a, mul(e, t))));
      if (!best || d < best.d) best = { a, b, d };
    }
    return best ? { a: best.a, b: best.b, z: prism.z1 } : null;
  }
  // The overhang typed for the edge picked: set (or, none, back to the settings) on each piece's bench that edge runs
  // along — from the face of what's under it that way.
  const setBenchEdgeOverhang = (mm: number | undefined) => {
    if (!benchEdge) return;
    const u = unit(sub(benchEdge.b, benchEdge.a));
    const length = len(sub(benchEdge.b, benchEdge.a));
    const along = new Map<string, Set<BenchEdge>>();
    for (const { id, strip } of benchStrips) {
      const c = (x: number, y: number) => toWorld(strip.frame, [x, y]);
      const edges: Array<[BenchEdge, Vec, Vec]> = [
        ["front", c(strip.x0, strip.y1), c(strip.x1, strip.y1)],
        ["back", c(strip.x0, strip.y0), c(strip.x1, strip.y0)],
        ["left", c(strip.x0, strip.y0), c(strip.x0, strip.y1)],
        ["right", c(strip.x1, strip.y0), c(strip.x1, strip.y1)],
      ];
      for (const [which, p0, p1] of edges) {
        if (Math.abs(cross(u, unit(sub(p1, p0)))) > 0.02 || Math.abs(cross(u, sub(p0, benchEdge.a))) > 2) continue;
        const t0 = dot(sub(p0, benchEdge.a), u);
        const t1 = dot(sub(p1, benchEdge.a), u);
        if (Math.min(Math.max(t0, t1), length) - Math.max(Math.min(t0, t1), 0) < 1) continue;
        along.set(id, new Set([...(along.get(id) ?? []), which]));
      }
    }
    if (!along.size) return;
    setItems((prev) =>
      prev.map((item) => {
        const edges = along.get(item.id);
        if (!edges) return item;
        const next = { ...(item.benchOver ?? {}) };
        for (const which of edges) {
          if (mm === undefined) delete next[which];
          else next[which] = mm;
        }
        return { ...item, benchOver: Object.keys(next).length ? next : undefined };
      }),
    );
    setBenchEdge(null);
  };
  // Ctrl + scroll, while a piece is being dragged: it turns, a notch at a time, not the view zooming (or the browser's).
  const pieceInHand = Boolean(libDrag?.started || moving);
  useEffect(() => {
    if (!pieceInHand) return;
    let scrolled = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      scrolled += event.deltaY;
      if (Math.abs(scrolled) < 50) return;
      const by = scrolled > 0 ? Math.PI / 4 : -Math.PI / 4;
      scrolled = 0;
      setDragTurn((turn) => turn + by);
    };
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, [pieceInHand]);
  // A point on the screen, in the drawing's px (before its zoom).
  const svgPoint = (clientX: number, clientY: number): Vec | null => {
    const box = hostRef.current?.getBoundingClientRect();
    return box ? [(clientX - box.left - zoom.x) / zoom.z, (clientY - box.top - zoom.y) / zoom.z] : null;
  };
  const itemAt = (clientX: number, clientY: number): string | null => {
    const point = svgPoint(clientX, clientY);
    if (!point) return null;
    for (let i = projected.length - 1; i >= 0; i -= 1) {
      const face = projected[i];
      const id = itemOfPart(face.part);
      if (id && id !== GHOST_ID && inside(point, face.screen)) return id;
    }
    return null;
  };

  // Where something'd go, dropped (or let go) here: into the middle of a cabinet (fronts only), off the side of whatever
  // it's over, off the free side it's nearest (near enough), else on its own — turned as what's nearest is. `base`:
  // everything else, as it is while this one's on its way; `x`: it (`u`: its unit, from the library).
  const targetAt = (clientX: number, clientY: number, x: KitchenItem, u: KitchenUnit | undefined, base: KitchenItem[]): { target: DropTarget; level: Level } => {
    const bounds = heldBounds ?? model.bounds;
    const baseLaid = layoutKitchen(base, unitMap, gaps);
    const baseModel = kitchenModel(base, unitMap, gaps, baseLaid, offPieces, benchOver, bounds, extrusions).model;
    const seen = projectCabinetFaces(baseModel, cabinetModelFaces(baseModel).filter((face) => !partHidden(face.part)), view, size);
    const point = svgPoint(clientX, clientY) ?? [0, 0];
    const projector = cabinetViewProjector(baseModel, view, size);
    // (A snap's reach on the screen, in mm — the same on the screen however far it's zoomed.)
    const mmPerPx = 1 / Math.max(1e-6, projector.k * zoom.z);
    // (The point on the plan under it, at a height.)
    const planAt = (z: number): Vec => {
      const cy = Math.cos(view.yaw);
      const sy = Math.sin(view.yaw);
      const cp = Math.cos(view.pitch);
      const spRaw = Math.sin(view.pitch);
      const sp = Math.abs(spRaw) < 0.05 ? (spRaw < 0 ? -0.05 : 0.05) : spRaw;
      const x1 = (point[0] - size.width / 2) / projector.k;
      const v = (size.height / 2 - point[1]) / projector.k;
      const zt = ((z - projector.centre[2]) * cp - v) / sp;
      return [x1 * cy - zt * sy + projector.centre[0], x1 * sy + zt * cy + projector.centre[1]];
    };
    const byId = new Map(base.map((i) => [i.id, i]));
    const xSize = layoutKitchen([{ ...x, at: { kind: "free", x: 0, y: 0, a: 0 } }], unitMap, gaps).sizes.get(x.id);
    let hit: KitchenItem | undefined;
    let hitFace: (typeof seen)[number] | undefined;
    for (let i = seen.length - 1; i >= 0 && !hit; i -= 1) {
      const id = itemOfPart(seen[i].part);
      if (id && byId.has(id) && inside(point, seen[i].screen)) {
        hit = byId.get(id);
        hitFace = seen[i];
      }
    }
    // (Aimed up on the wall, over a base cabinet — not on it: against the wall behind it, below. Anything else: what's
    // under the pointer.)
    const aimedLevel = u ? levelFor(u, placing) : x.level;
    if (hit && aimedLevel === "wall" && hit.level === "base" && x.kind !== "panel" && !baseLaid.sizes.get(hit.id)?.tall && baseLaid.sizes.get(hit.id)?.panelAs !== "wall") {
      hit = undefined;
      hitFace = undefined;
    }
    // (Off a side of something: and what was there at that height moves along to after it.)
    const offSide = (h: KitchenItem, side: string, level: Level = h.level): Extract<DropTarget, { kind: "attach" }> => {
      const child = base.find((c) => c.at.kind === "attach" && c.at.to === h.id && c.at.side === side && c.level === level);
      if (child) return { kind: "attach", to: h.id, side, insert: child.id };
      if (level === h.level && h.at.kind === "attach" && baseLaid.plug.get(h.id) === side) return { kind: "attach", to: h.at.to, side: h.at.side, insert: h.id };
      return { kind: "attach", to: h.id, side };
    };
    // Onto a tall panel or cabinet: its top half, up as an overhead — its top on that one's top (and off a panel, at its
    // front; off a cabinet, its back on its back); its bottom half, down at the bottom with it.
    const upOnTall = (h: KitchenItem, side: string, hSize: ItemSize): { target: DropTarget; level: Level } | null => {
      const own = layoutKitchen([{ ...x, level: "wall", lift: undefined, at: { kind: "free", x: 0, y: 0, a: 0 } }], unitMap, gaps).sizes.get(x.id);
      if (!own || own.tall || own.height >= hSize.height) return null;
      return {
        target: { ...offSide(h, side, "wall"), lift: hSize.z0 + hSize.height - (own.z0 + own.height), ...(h.kind === "panel" ? {} : { rel: { x: 0, y: own.depth - hSize.depth, a: 0 } }) },
        level: "wall",
      };
    };
    // (A side an overhead's snapped to, of something tall on the floor: up as on it.)
    const upIfTall = (t: DropTarget, level: Level): { target: DropTarget; level: Level } => {
      const h = t.kind === "attach" ? byId.get(t.to) : undefined;
      const hSize = h ? baseLaid.sizes.get(h.id) : undefined;
      if (level !== "wall" || t.kind !== "attach" || !h || !hSize?.tall || h.level !== "base") return { target: t, level };
      return upOnTall(h, t.side, hSize) ?? { target: t, level: h.level };
    };
    const offTall = (h: KitchenItem, side: string, hSize: ItemSize, hFrame: Frame): { target: DropTarget; level: Level } => {
      const plain = { target: offSide(h, side), level: aimedLevel === "wall" && hSize.panelAs === "wall" ? ("wall" as const) : h.level };
      if ((x.kind !== "box" && x.kind !== "custom") || !hSize.tall) return plain;
      const mid = toWorld(hFrame, localCentre(h, hSize, unitMap));
      const foot = projector.project([mid[0], mid[1], hSize.z0]) as Vec;
      const head = projector.project([mid[0], mid[1], hSize.z0 + hSize.height]) as Vec;
      const rise = sub(head, foot);
      const high = dot(sub(point, foot), rise) / Math.max(1e-6, dot(rise, rise)) > 0.5;
      if (!high) return { target: { ...offSide(h, side, "base"), lift: hSize.z0 }, level: "base" };
      return upOnTall(h, side, hSize) ?? plain;
    };
    // The free side nearest the pointer, and how far (mm): each looked for at its own height — where it's seen — and on
    // the floor beside it (the nearer), measured to the whole side (its front corner to its back), one the pointer's
    // behind counted well further off. (A panel's side is too thin to land on: near it is enough.)
    const freeSideNear = (level: Level | null): { target: DropTarget; d: number } | null => {
      let best: { target: DropTarget; d: number } | null = null;
      for (const item of base) {
        const s = baseLaid.sizes.get(item.id);
        if (!s) continue;
        // (An overhead, by something tall on the floor: its side's as good as an overhead's.)
        const upBeside = level === "wall" && item.level === "base" && s.tall && (x.kind === "box" || x.kind === "custom");
        if (level && item.level !== level && !upBeside) continue;
        const looks = [planAt(s.z0 + s.height / 2), planAt(item.level === "wall" ? s.z0 : 0), ...(upBeside ? [planAt(wallZ0(gaps) + 360)] : [])];
        for (const socket of baseLaid.sockets.get(item.id) ?? []) {
          const taken = upBeside
            ? base.some((c) => c.at.kind === "attach" && c.at.to === item.id && c.at.side === socket.id && c.level === "wall")
            : base.some((c) => c.at.kind === "attach" && c.at.to === item.id && c.at.side === socket.id) || baseLaid.plug.get(item.id) === socket.id;
          if (taken) continue;
          const back = sub(socket.p, mul(socket.f, s.depth));
          const e = sub(back, socket.p);
          const d = Math.min(
            ...looks.map((at) => {
              const t = Math.max(0, Math.min(1, dot(sub(at, socket.p), e) / Math.max(1e-6, dot(e, e))));
              const v = sub(at, add(socket.p, mul(e, t)));
              return len(v) + (dot(v, socket.n) < 0 ? 400 : 0);
            }),
          );
          if (!best || d < best.d) best = { target: { kind: "attach", to: item.id, side: socket.id }, d };
        }
      }
      return best;
    };
    const hs = hit ? baseLaid.sizes.get(hit.id) : undefined;
    const hf = hit ? baseLaid.frames.get(hit.id) : undefined;
    // A panel onto a cabinet's kick: a kick board, hard to the end it's nearer.
    if (hit && hs && hf && (u ? u.kind === "panel" : x.kind === "panel") && hit.kind === "panel" && hit.at.kind === "attach" && hitFace?.part.endsWith(":backing-kick")) {
      // (The kick under a face panel's false cabinet: hard to the end of it the pointer's nearer.)
      const run = byId.get(hit.at.to);
      const rf = run ? baseLaid.frames.get(run.id) : undefined;
      const rs = run ? baseLaid.sizes.get(run.id) : undefined;
      if (run && rf && rs) {
        const span = faceSpan(hit, hf, hs, rf, rs);
        const at = planAt(kickOf(gaps) / 2);
        const x0 = dot(sub(at, rf.o), rot(rf.a, [1, 0]));
        const t = (x0 - span.lo) / Math.max(1e-6, span.hi - span.lo);
        return { target: { kind: "attach", to: hit.id, side: t < 0.5 ? "kick-left" : "kick-right" }, level: hit.level };
      }
    }
    if (hit && hs && hf && (u ? u.kind === "panel" : x.kind === "panel") && hit.kind === "box" && hitFace?.part.endsWith(":kick")) {
      const l = toWorld(hf, [0, -KICK_SETBACK_MM]);
      const r = toWorld(hf, [hs.width, -KICK_SETBACK_MM]);
      const sl = projector.project([l[0], l[1], kickOf(gaps) / 2]);
      const sr = projector.project([r[0], r[1], kickOf(gaps) / 2]);
      const along = sub(sr, sl);
      const t = dot(sub(point, sl), along) / Math.max(1e-6, dot(along, along));
      return { target: { kind: "attach", to: hit.id, side: t < 0.5 ? "kick-left" : "kick-right" }, level: hit.level };
    }
    // A Cabinetry cabinet onto a cabinet made from fronts: in behind them.
    if (hit && u?.kind === "cabinet" && hit.kind === "box" && !hit.unitId) return { target: { kind: "into", itemId: hit.id, behind: true }, level: hit.level };
    if (hit && hs && hf && u?.kind === "fronts" && hit.kind === "box" && hitFace?.part.includes(":front:")) {
      // A front onto one of a cabinet's fronts: beside it, above or below it — the side of it the pointer's nearest.
      const f = boxFronts(hit, hs, unitMap, gaps)[Number(hitFace.part.split(":front:")[1])];
      if (f) {
        const t = Math.max(3, f.front.thicknessMm);
        const at = (x: number, z: number) => {
          const q = toWorld(hf, [x, t]);
          return projector.project([q[0], q[1], z]) as Vec;
        };
        const o = at(f.x0, f.z1);
        const ex = sub(at(f.x1, f.z1), o);
        const ey = sub(at(f.x0, f.z0), o);
        const det = cross(ex, ey);
        if (Math.abs(det) > 1e-6) {
          const d = sub(point, o);
          const across = cross(d, ey) / det;
          const down = cross(ex, d) / det;
          const sides: Array<["above" | "below" | "left" | "right", number]> = [
            ["left", across],
            ["right", 1 - across],
            ["above", down],
            ["below", 1 - down],
          ];
          const side = sides.reduce((best, s2) => (s2[1] < best[1] ? s2 : best))[0];
          return { target: { kind: "into", itemId: hit.id, place: { col: f.col, row: f.row, side } }, level: hit.level };
        }
      }
    }
    if (hit && hs && hf) {
      const midZ = hs.z0 + hs.height / 2;
      // (Right by a panel's free edge — too thin to land on — though it's over the next thing: that edge.)
      const near = freeSideNear(hit.level);
      if (snapOn && near && near.target.kind === "attach" && near.target.to !== hit.id && byId.get(near.target.to)?.kind === "panel" && near.d < THIN_SNAP_PX * mmPerPx) {
        return upIfTall(near.target, hit.level);
      }
      // A side face: that side. (Looking that way, near enough.)
      const normal = hitFace?.normal;
      if (normal && Math.abs(normal[2]) < 0.5) {
        const looking = unit([normal[0], normal[1]]);
        const facing = (baseLaid.sockets.get(hit.id) ?? []).reduce<{ id: string; d: number } | null>((best, sk) => {
          const d = dot(sk.n, looking);
          return d > 0.7 && (!best || d > best.d) ? { id: sk.id, d } : best;
        }, null);
        if (facing) return offTall(hit, facing.id, hs, hf);
      }
      if (hit.kind === "custom" || isFacePanel(hit)) {
        const plan = planAt(midZ);
        const nearest = (baseLaid.sockets.get(hit.id) ?? []).reduce<Socket | null>((best, s) => (!best || len(sub(s.p, plan)) < len(sub(best.p, plan)) ? s : best), null);
        if (nearest) return offTall(hit, nearest.id, hs, hf);
      } else {
        // A front or a top (or a panel's edge): the side of it the pointer's nearer, seen along it — 0 its left end, 1 its right.
        const left = toWorld(hf, [0, 0]);
        const right = toWorld(hf, [hs.width, 0]);
        const sl = projector.project([left[0], left[1], midZ]);
        const sr = projector.project([right[0], right[1], midZ]);
        const along = sub(sr, sl);
        const t = dot(sub(point, sl), along) / Math.max(1e-6, dot(along, along));
        if (u?.kind === "fronts" && hit.kind === "box" && t >= 0.22 && t <= 0.78) return { target: { kind: "into", itemId: hit.id }, level: hit.level };
        return offTall(hit, t < 0.5 ? "left" : "right", hs, hf);
      }
    }
    const level = u ? levelFor(u, placing) : x.level;
    // (Where it's pointing on the floor — a wall one, at a wall cabinet's height — kept near what's there, never a long
    // way off.)
    const onFloor = planAt(level === "wall" ? wallZ0(gaps) + 360 : 0);
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const plan: Vec = [clamp(onFloor[0], bounds.minX - 8000, bounds.maxX + 8000), clamp(onFloor[1], bounds.minY - 8000, bounds.maxY + 8000)];
    if (!xSize) return { target: { kind: "free", x: plan[0], y: plan[1], a: 0 }, level };
    const best = freeSideNear(level);
    if (snapOn && best && best.d < SNAP_PX * mmPerPx) return upIfTall(best.target, level);
    // (Up on the wall, over or near a base cabinet: against the wall behind it — its back on that one's back, turned as
    // it is — where along it the pointer is.)
    if (level === "wall" && x.kind !== "custom") {
      let wallBest: { f: Frame; s2: ItemSize; d: number } | null = null;
      for (const item of base) {
        if (item.kind !== "box" || item.level !== "base") continue;
        const f = baseLaid.frames.get(item.id);
        const s2 = baseLaid.sizes.get(item.id);
        if (!f || !s2 || s2.tall) continue;
        const b0 = toWorld(f, [0, -s2.depth]);
        const e = sub(toWorld(f, [s2.width, -s2.depth]), b0);
        const t = Math.max(0, Math.min(1, dot(sub(plan, b0), e) / Math.max(1e-9, dot(e, e))));
        const d = len(sub(plan, add(b0, mul(e, t))));
        if (d < 900 && (!wallBest || d < wallBest.d)) wallBest = { f, s2, d };
      }
      if (wallBest) {
        const { f, s2 } = wallBest;
        const along = dot(sub(plan, f.o), rot(f.a, [1, 0]));
        const o = toWorld(f, [along - xSize.width / 2, -s2.depth + xSize.depth]);
        return { target: { kind: "free", x: o[0], y: o[1], a: f.a, wall: true }, level };
      }
    }
    // (On its own, its middle here — turned as what's nearest it is.)
    let a = 0;
    let nearest = Infinity;
    for (const item of base) {
      const frame = baseLaid.frames.get(item.id);
      const s = baseLaid.sizes.get(item.id);
      if (!frame || !s) continue;
      const d = len(sub(toWorld(frame, localCentre(item, s, unitMap)), plan));
      if (d < nearest && d < 2500) {
        nearest = d;
        a = item.kind === "custom" ? 0 : frame.a;
      }
    }
    const o = sub(plan, rot(a, localCentre(x, xSize, unitMap)));
    return { target: { kind: "free", x: o[0], y: o[1], a }, level };
  };

  // A unit in — where a drop says (or, with +, onto what's picked) — and a Cabinetry one's sub parts with it: its fronts
  // on it, its panels at its ends.
  const commitUnit = (u: KitchenUnit, target: DropTarget, level: Level) => {
    if (u.kind === "other" || (usedCount.get(u.id) ?? 0) >= u.quantity) return;
    const x = itemFor(u, level);
    // (Its sub parts with it — not put in behind fronts already there.)
    const subs =
      u.kind === "cabinet" && !(target.kind === "into" && target.behind)
        ? u.subUnits.map((id) => unitMap.get(id)).filter((s): s is KitchenUnit => s !== undefined && (usedCount.get(s.id) ?? 0) < s.quantity)
        : [];
    const withSubs = subs.filter((s) => s.kind === "fronts").reduce((item, s) => withFront(item, s, unitMap), x);
    let next = applyTarget(liveItems, withSubs, target, level, unitMap);
    const panels = subs.filter((s) => s.kind === "panel");
    if (panels.length) {
      const laidNext = layoutKitchen(next, unitMap, gaps);
      const free = ["left", "right"].filter(
        (side) => !next.some((c) => c.at.kind === "attach" && c.at.to === x.id && c.at.side === side) && laidNext.plug.get(x.id) !== side,
      );
      panels.slice(0, free.length).forEach((p, i) => {
        next = [...next, { ...itemFor(p, level), at: { kind: "attach", to: x.id, side: free[i] } }];
      });
    }
    next = lineUpOverhead(next, x.id, unitMap, gaps, true);
    // (Fronts made into a cabinet: as deep as a real cabinet it's run off — else, overhead, how deep it is asked.)
    if (u.kind === "fronts" && target.kind !== "into") {
      const beside = target.kind === "attach" ? liveItems.find((i) => i.id === target.to) : undefined;
      const realDepth = beside && beside.kind === "box" && beside.unitId ? laidNow.sizes.get(beside.id)?.depth : undefined;
      if (realDepth && beside?.level === level) next = next.map((i) => (i.id === x.id ? { ...i, depthMm: realDepth } : i));
      else if (level === "wall") setDepthAsk({ id: x.id, text: String(WALL_DEPTH) });
    }
    if (!heldBounds) setHeldBounds(model.bounds);
    setItems(next);
    setSelectedId(target.kind === "into" ? target.itemId : x.id);
  };
  const plusTarget = (u: KitchenUnit): { target: DropTarget; level: Level } => {
    const picked = liveItems.find((i) => i.id === selectedId);
    if (picked && u.kind === "fronts" && picked.kind === "box") return { target: { kind: "into", itemId: picked.id }, level: picked.level };
    // (A Cabinetry cabinet, a cabinet made from fronts picked: in behind them.)
    if (picked && u.kind === "cabinet" && picked.kind === "box" && !picked.unitId) return { target: { kind: "into", itemId: picked.id, behind: true }, level: picked.level };
    const laidNow = layoutKitchen(liveItems, unitMap, gaps);
    const freeSide = (item: KitchenItem) =>
      (laidNow.sockets.get(item.id) ?? [])
        .map((s) => s.id)
        .sort((a, b) => (a === "right" ? -1 : b === "right" ? 1 : 0))
        .find((side) => !liveItems.some((c) => c.at.kind === "attach" && c.at.to === item.id && c.at.side === side) && laidNow.plug.get(item.id) !== side);
    const anchor = picked ?? [...liveItems].reverse().find((i) => i.level === levelFor(u, placing));
    const side = anchor ? freeSide(anchor) : undefined;
    if (anchor && side) return { target: { kind: "attach", to: anchor.id, side }, level: anchor.level };
    return { target: { kind: "free", x: 0, y: 0, a: 0 }, level: levelFor(u, placing) };
  };

  // The view, gently, to one looking this way (the shortest way round).
  const viewAnimRef = useRef(0);
  const goToView = (to: CabinetView) => {
    window.cancelAnimationFrame(viewAnimRef.current);
    const from = view;
    let yawBy = (to.yaw - from.yaw) % (2 * Math.PI);
    if (yawBy > Math.PI) yawBy -= 2 * Math.PI;
    if (yawBy < -Math.PI) yawBy += 2 * Math.PI;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 240);
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      setView({ yaw: from.yaw + yawBy * eased, pitch: from.pitch + (to.pitch - from.pitch) * eased });
      if (t < 1) viewAnimRef.current = window.requestAnimationFrame(step);
    };
    viewAnimRef.current = window.requestAnimationFrame(step);
  };
  // Fit: the view round what's there — and from now till something's changed. (Otherwise it stays put.)
  const fitView = () => {
    setHeldBounds(null);
    resetZoom();
  };
  const goHome = () => {
    goToView(HOME_VIEW);
    fitView();
  };
  const chooseTool = (next: DrawTool) => {
    setTool((now) => (now === next ? "select" : next));
    // (Nothing picked to get in the way of a face or a point being clicked.)
    if (next === "measure" || next === "extrude") setSelectedId(null);
    setMoveDraft(null);
    setRotateTyped(null);
    setExtrude(null);
    setExtrudeHover(null);
    setMeasure(null);
    setMeasureHover(null);
    setFaceMeasure(null);
    setFaceHover(null);
    setBenchEdge(null);
    setNavTool(null);
    setMenu(null);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const key = event.key.toLowerCase();
      if (keyIsForField(event, /^[a-z]$/.test(key))) return;
      if (key === "escape") {
        if (measure) setMeasure(null);
        else if (faceMeasure) setFaceMeasure(null);
        else if (extrude) setExtrude(null);
        else if (tool !== "select") chooseTool(tool);
        else setSelectedId(null);
        return;
      }
      const tools: Record<string, DrawTool> = { v: "select", m: "move", r: "rotate", e: "extrude", i: "measure" };
      // (Not typed into a box that it brings up, or that's already there.)
      if (tools[key] || key === "h" || key === "f") event.preventDefault();
      if (tools[key]) chooseTool(tools[key] === tool ? "select" : tools[key]);
      else if (key === "h") goHome();
      else if (key === "f") fitView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Moving what's in it: a press on something (the left button, or a finger) and a drag — let go where it's to go. A
  // press that doesn't move picks it. Anywhere else, the view's own gestures.
  const moveRef = useRef<{ pointerId: number; id: string; x: number; y: number; moved: boolean } | null>(null);
  // (Where the pointer is on the plan, at a height — the view held as it is.)
  const planPointAt = (clientX: number, clientY: number, z: number): Vec => {
    const point = svgPoint(clientX, clientY) ?? [0, 0];
    const projector = cabinetViewProjector(model, view, size);
    const cy = Math.cos(view.yaw);
    const sy = Math.sin(view.yaw);
    const cp = Math.cos(view.pitch);
    const spRaw = Math.sin(view.pitch);
    const sp = Math.abs(spRaw) < 0.05 ? (spRaw < 0 ? -0.05 : 0.05) : spRaw;
    const x1 = (point[0] - size.width / 2) / projector.k;
    const v = (size.height / 2 - point[1]) / projector.k;
    const zt = ((z - projector.centre[2]) * cp - v) / sp;
    return [x1 * cy - zt * sy + projector.centre[0], x1 * sy + zt * cy + projector.centre[1]];
  };
  // (Every 45°: snapped to, within 5°.)
  const snap45 = (a: number) => {
    const deg = (a * 180) / Math.PI;
    const near = Math.round(deg / 45) * 45;
    return Math.abs(deg - near) < 5 ? (near * Math.PI) / 180 : a;
  };
  // Rotate: a press on the drawing starts turning what's picked — about the pivot of what it's run off (its corner at the
  // joint, if none's picked), or its own (on its own). A press on something else picks that instead.
  const startRotate = (event: ReactPointerEvent<HTMLDivElement>): boolean => {
    const item = selected;
    if (!rotateTool || !item || item.kind === "custom") return false;
    // (An angle waiting: kept, and that's all this press does.)
    if (typedTurn) {
      lockTurn();
      return true;
    }
    const over = itemAt(event.clientX, event.clientY);
    if (over && over !== item.id) {
      setSelectedId(over);
      return true;
    }
    if (item.locked) return true;
    const size_ = laidNow.sizes.get(item.id);
    const frame = laidNow.frames.get(item.id);
    if (!size_ || !frame) return false;
    let pivot: Vec | null = null;
    // (Measured round it at the height its dot's drawn — the top of what it's on.)
    let z = size_.z0 + size_.height + (size_.bench ? BENCH_MM : 0) + 2;
    if (item.at.kind === "attach") {
      const at = item.at;
      const parent = liveItems.find((i) => i.id === at.to);
      const ps = parent ? laidNow.sizes.get(parent.id) : undefined;
      const pf = parent ? laidNow.frames.get(parent.id) : undefined;
      const print = parent && ps ? footprintOf(parent, ps) : null;
      if (parent?.pivot && print && pf) pivot = toWorld(pf, footprintCorner(print, parent.pivot));
      else pivot = (parent ? laidNow.sockets.get(parent.id) : undefined)?.find((sk) => sk.id === at.side)?.p ?? null;
      if (ps) z = ps.z0 + ps.height + (ps.bench ? BENCH_MM : 0) + 2;
    } else {
      const print = footprintOf(item, size_);
      if (print) pivot = toWorld(frame, footprintCorner(print, ownPivotOf(item)));
    }
    if (!pivot) return false;
    const start = planPointAt(event.clientX, event.clientY, z);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // (Already let go.)
    }
    rotateRef.current = {
      pointerId: event.pointerId,
      id: item.id,
      pivot,
      z,
      last: Math.atan2(start[1] - pivot[1], start[0] - pivot[0]),
      total: 0,
      base: item.at.kind === "attach" ? item.at.turn ?? 0 : frame.a,
      frame: item.at.kind === "free" ? frame : null,
    };
    setHeldBounds(model.bounds);
    return true;
  };
  // Where something moved goes, facing the way it does now: on its own — its middle where it'd be, turned as it is; run
  // off something — turned at that joint as far as it takes to face that way still.
  const keepFacing = (item: KitchenItem, target: DropTarget, base: KitchenItem[]): DropTarget => {
    const now = laidNow.frames.get(item.id);
    const size_ = laidNow.sizes.get(item.id);
    if (!now || !size_ || target.kind === "into") return target;
    if (target.kind === "free") {
      const c = localCentre(item, size_, unitMap);
      const mid = add([target.x, target.y], rot(target.a, c));
      const o = sub(mid, rot(now.a, c));
      return { kind: "free", x: o[0], y: o[1], a: now.a };
    }
    const straight = layoutKitchen(applyTarget(base, item, { ...target, turn: undefined }, item.level, unitMap), unitMap, gaps).frames.get(item.id);
    if (!straight) return target;
    let turn = now.a - straight.a;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn <= -Math.PI) turn += 2 * Math.PI;
    return Math.abs(turn) > 1e-3 ? { ...target, turn } : { ...target, turn: undefined };
  };
  // On its own near a run facing (near enough) the way it does: in line with it — its front on that run's front line,
  // turned exactly as it is — wherever along it it's put.
  const inLine = (item: KitchenItem, target: DropTarget, base: KitchenItem[]): DropTarget => {
    if (!snapOn || target.kind !== "free" || item.kind === "custom") return target;
    const others = layoutKitchen(base, unitMap, gaps);
    const size_ = layoutKitchen([{ ...item, at: { kind: "free", x: 0, y: 0, a: 0 } }], unitMap, gaps).sizes.get(item.id);
    const mid = size_ ? add([target.x, target.y], rot(target.a, localCentre(item, size_, unitMap))) : ([target.x, target.y] as Vec);
    let best: { off: number; a: number; out: Vec } | null = null;
    for (const other of base) {
      if (other.level !== item.level || other.kind === "custom") continue;
      const f = others.frames.get(other.id);
      const s2 = others.sizes.get(other.id);
      if (!f || !s2) continue;
      let da = target.a - f.a;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da <= -Math.PI) da += 2 * Math.PI;
      if (Math.abs(da) > (3 * Math.PI) / 180) continue;
      if (len(sub(mid, toWorld(f, localCentre(other, s2, unitMap)))) > 3000) continue;
      const out = rot(f.a, [0, 1]);
      const off = dot(sub([target.x, target.y], f.o), out);
      const reach = SNAP_PX / Math.max(1e-6, cabinetViewProjector(model, view, size).k * zoom.z);
      if (Math.abs(off) < reach && (!best || Math.abs(off) < Math.abs(best.off))) best = { off, a: f.a, out };
    }
    if (!best) return target;
    const o = sub([target.x, target.y], mul(best.out, best.off));
    return { kind: "free", x: o[0], y: o[1], a: best.a, aligned: true };
  };
  // Move: a press on the drawing starts sliding what's picked along the axis picked (a press on something else picks that
  // instead) — how far: along its axis on the plan, under the pointer at its height; up and down, the pointer's rise.
  // (`arrow`: one of its arrows pressed — that axis, from here; a move pending along another, locked in first.)
  const startMove = (event: ReactPointerEvent<Element>, arrow?: MoveAxis): boolean => {
    const item = selected;
    if (!moveTool || !item) return false;
    if (!arrow) {
      const over = itemAt(event.clientX, event.clientY);
      if (over && over !== item.id) {
        setMoveDraft(null);
        setSelectedId(over);
        return true;
      }
    }
    if (item.locked) return true;
    const axis = arrow ?? moveAxis;
    let base = draft?.delta ?? 0;
    if (axis !== moveAxis) {
      lockMove();
      setMoveAxis(axis);
      base = 0;
    }
    const f = laidNow.frames.get(item.id);
    const sz = laid.sizes.get(item.id);
    if (!f || !sz) return false;
    const z = arrow ? sz.z0 + sz.height + (sz.bench ? BENCH_MM : 0) + 10 : sz.z0 + sz.height / 2;
    try {
      hostRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // (Already let go.)
    }
    moveDragRef.current = {
      pointerId: event.pointerId,
      id: item.id,
      axis,
      startPlan: planPointAt(event.clientX, event.clientY, z),
      startY: svgPoint(event.clientX, event.clientY)?.[1] ?? 0,
      z,
      base,
      dir: rot(f.a, axis === "y" ? [0, 1] : [1, 0]),
    };
    setHeldBounds(model.bounds);
    return true;
  };
  const lockTurn = () => {
    if (typedTurn) update(typedTurn.id, { at: { kind: "free", ...typedTurn.free } });
    setRotateTyped(null);
  };
  const lockMove = () => {
    if (draft?.delta) setItems(moveBy(liveItems, draft.id, moveAxis, draft.delta, unitMap, gaps));
    setMoveDraft(null);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button, input, [data-kitchen-menu], [data-kitchen-pivot], [data-kitchen-gizmo]")) return;
    setMenu(null);
    setShowMenuAt(null);
    const pressing = event.pointerType !== "mouse" || event.button === 0;
    // (Orbit or Pan on: just that.)
    if (navTool) {
      handlers.onPointerDown(event);
      return;
    }
    if (tool === "measure") {
      handlers.onPointerDown(event);
      return;
    }
    if (tool === "extrude") {
      const face = pressing ? benchFaceAt(event.clientX, event.clientY) : null;
      if (!face) {
        handlers.onPointerDown(event);
        return;
      }
      const same = extrude && extrude.face.key === face.key;
      if (!same && extrude?.dist) commitExtrude();
      const held = same ? extrude.face : face;
      if (!same) setExtrude({ face, dist: 0, text: "0" });
      startExtrudeDrag(event, held, same ? extrude.dist : 0);
      return;
    }
    if ((event.pointerType !== "mouse" || event.button === 0) && startRotate(event)) return;
    if ((event.pointerType !== "mouse" || event.button === 0) && startMove(event)) return;
    if (event.pointerType === "mouse" && event.button === 2) rightDownRef.current = { x: event.clientX, y: event.clientY };
    const primary = event.pointerType === "mouse" ? event.button === 0 : true;
    const id = primary && !moveRef.current ? itemAt(event.clientX, event.clientY) : null;
    if (id) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // (Already let go.)
      }
      moveRef.current = { pointerId: event.pointerId, id, x: event.clientX, y: event.clientY, moved: false };
      return;
    }
    handlers.onPointerDown(event);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pushing = extrudeDragRef.current;
    if (pushing && pushing.pointerId === event.pointerId) {
      let by: number;
      if (pushing.face.kind === "side") by = dot(sub(planPointAt(event.clientX, event.clientY, pushing.z), pushing.startPlan), pushing.out);
      else {
        const y = svgPoint(event.clientX, event.clientY)?.[1] ?? pushing.startY;
        const k = cabinetViewProjector(model, view, size).k;
        const up = (pushing.startY - y) / Math.max(1e-6, k * Math.max(0.2, Math.cos(view.pitch)));
        by = pushing.face.kind === "top" ? up : -up;
      }
      const mm = Math.round(pushing.base + by);
      setExtrude((prev) => (prev ? { ...prev, dist: mm, text: String(mm) } : prev));
      return;
    }
    if (tool === "measure" && event.buttons === 0) {
      const at = measurePointAt(event.clientX, event.clientY);
      setMeasureHover(at);
      setFaceHover(at ? null : measureFaceAt(event.clientX, event.clientY));
    }
    if (tool === "extrude" && event.buttons === 0) {
      const key = benchFaceAt(event.clientX, event.clientY)?.key ?? null;
      setExtrudeHover((prev) => (prev === key ? prev : key));
    }
    const sliding = moveDragRef.current;
    if (sliding && sliding.pointerId === event.pointerId) {
      let delta: number;
      if (sliding.axis === "z") {
        const y = svgPoint(event.clientX, event.clientY)?.[1] ?? sliding.startY;
        const k = cabinetViewProjector(model, view, size).k;
        delta = sliding.base + (sliding.startY - y) / Math.max(1e-6, k * Math.max(0.2, Math.cos(view.pitch)));
      } else delta = sliding.base + dot(sub(planPointAt(event.clientX, event.clientY, sliding.z), sliding.startPlan), sliding.dir);
      const mm = Math.round(delta);
      setMoveDraft({ id: sliding.id, delta: mm, text: String(mm) });
      return;
    }
    const turning = rotateRef.current;
    if (turning && turning.pointerId === event.pointerId) {
      const at = planPointAt(event.clientX, event.clientY, turning.z);
      const angle = Math.atan2(at[1] - turning.pivot[1], at[0] - turning.pivot[0]);
      let step = angle - turning.last;
      while (step > Math.PI) step -= 2 * Math.PI;
      while (step < -Math.PI) step += 2 * Math.PI;
      turning.last = angle;
      turning.total += step;
      const target = snap45(turning.base + turning.total);
      if (turning.frame) {
        const by = target - turning.frame.a;
        const o = add(turning.pivot, rot(by, sub(turning.frame.o, turning.pivot)));
        setRotating({ id: turning.id, free: { x: o[0], y: o[1], a: target } });
      } else setRotating({ id: turning.id, turn: target });
      return;
    }
    if (pivotDrag && pivotDrag.pointerId === event.pointerId) {
      const moved = pivotDrag.moved || Math.hypot(event.clientX - pivotDrag.x, event.clientY - pivotDrag.y) > 4;
      // (Starting off from a spot it shares with a dot of what's picked: it's what's picked that's dragged.)
      let from = pivotDrag.from;
      if (moved && !pivotDrag.moved && from.id !== selectedId) {
        const at = allDots.find((d) => sameRef(d.ref, from));
        const gap = (d: { x: number; y: number }) => (at ? len(sub([d.x, d.y], [at.x, at.y])) * zoom.z : Infinity);
        const mine = allDots.filter((d) => d.ref.id === selectedId && gap(d) < 9).sort((a, b) => gap(a) - gap(b))[0];
        if (mine) from = mine.ref;
      }
      const over = dotNear(event.clientX, event.clientY, from.id);
      setPivotDrag({ ...pivotDrag, from, over, moved, pointer: svgPoint(event.clientX, event.clientY) });
      return;
    }
    const drag = moveRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      if (liveItems.find((i) => i.id === drag.id)?.locked) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        setDragTurn(0);
        setHeldBounds(model.bounds);
        setSelectedId(drag.id);
      }
      const item = liveItems.find((i) => i.id === drag.id);
      if (!item) return;
      const base = pullOut(liveItems, drag.id);
      const keep = descendants(base, drag.id);
      const found = targetAt(event.clientX, event.clientY, item, undefined, base.filter((i) => !keep.has(i.id))).target;
      const others = base.filter((i) => !keep.has(i.id));
      setMoving({ id: drag.id, target: inLine(item, keepFacing(item, found, base), others), level: item.level });
      return;
    }
    handlers.onPointerMove(event);
    if (event.buttons !== 0) return;
    const part = itemAt(event.clientX, event.clientY);
    setHoverPart((prev) => (prev === part ? prev : part));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pushing = extrudeDragRef.current;
    if (pushing && pushing.pointerId === event.pointerId) {
      extrudeDragRef.current = null;
      return;
    }
    const sliding = moveDragRef.current;
    if (sliding && sliding.pointerId === event.pointerId) {
      moveDragRef.current = null;
      return;
    }
    const turning = rotateRef.current;
    if (turning && turning.pointerId === event.pointerId) {
      rotateRef.current = null;
      const item = liveItems.find((i) => i.id === turning.id);
      if (item && rotating && event.type === "pointerup") {
        if (rotating.free) update(item.id, { at: { kind: "free", ...rotating.free } });
        else commitTurn(item, rotating.turn ?? 0);
      }
      setRotating(null);
      return;
    }
    if (pivotDrag && pivotDrag.pointerId === event.pointerId) {
      // (Where it was let go counts, whatever was last heard.)
      const last = pivotDrag.moved ? dotNear(event.clientX, event.clientY, pivotDrag.from.id) ?? pivotDrag.over : pivotDrag.from;
      if (event.type === "pointerup") dropCorner(pivotDrag.from, last);
      setPivotDrag(null);
      return;
    }
    const drag = moveRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      moveRef.current = null;
      const item = liveItems.find((i) => i.id === drag.id);
      if (drag.moved && moving && item && event.type === "pointerup") {
        setItems(bakeTurn(lineUpOverhead(applyTarget(pullOut(liveItems, drag.id), item, withDragTurn(item, moving.target), moving.level, unitMap), drag.id, unitMap, gaps, false), item.id, unitMap, gaps));
      }
      else if (!drag.moved) setSelectedId(drag.id);
      setMoving(null);
      return;
    }
    handlers.onPointerUp(event);
  };

  const selectedSize = selected ? laidNow.sizes.get(selected.id) ?? null : null;
  const selectedUnit = selected?.unitId ? unitMap.get(selected.unitId) : undefined;
  const update = (id: string, patch: Partial<KitchenItem>) => setItems((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  // A cabinet made from fronts set to a depth — on its own, moved forward (or back) by the change so its back stays put
  // (against the wall).
  const setDepth = (id: string, mm: number) => {
    if (!Number.isFinite(mm) || mm < 50) return;
    const was = laidNow.sizes.get(id)?.depth ?? mm;
    setItems((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (c.at.kind !== "free") return { ...c, depthMm: mm, at: c.at.rel ? { ...c.at, rel: { ...c.at.rel, y: c.at.rel.y + mm - was } } : c.at };
        const o = add([c.at.x, c.at.y], mul(rot(c.at.a, [0, 1]), mm - was));
        return { ...c, depthMm: mm, at: { ...c.at, x: o[0], y: o[1] } };
      }),
    );
  };
  // (On its own where it is now.)
  const freeAt = (id: string): Placement => {
    const frame = laidNow.frames.get(id) ?? { o: [0, 0] as Vec, a: 0 };
    return { kind: "free", x: frame.o[0], y: frame.o[1], a: frame.a };
  };
  const remove = (id: string) => {
    if (liveItems.find((i) => i.id === id)?.locked) return;
    // (The sub parts that came in with a Cabinetry cabinet — its panels, run off it — go with it. What else ran off it
    // closes up onto what it ran off — or, with nothing there, stays where it is.)
    const item = liveItems.find((i) => i.id === id);
    const cab = item?.unitId ? unitMap.get(item.unitId) : undefined;
    const subs = new Set(cab?.kind === "cabinet" ? cab.subUnits : []);
    const gone = new Set([id, ...liveItems.filter((c) => c.kind === "panel" && c.at.kind === "attach" && c.at.to === id && c.unitId && subs.has(c.unitId)).map((c) => c.id)]);
    const kept = liveItems.filter((c) => c.id === id || !gone.has(c.id));
    setItems(pullOut(kept, id).map((c) => (c.at.kind === "attach" && gone.has(c.at.to) ? { ...c, at: freeAt(c.id) } : c)));
    setSelectedId(null);
  };
  // Delete (or Backspace): what's picked, out.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (keyIsForField(event)) return;
      // (Backspace, in a measurement box, is only ever for the number.)
      if (event.key === "Backspace" && event.target instanceof HTMLElement && event.target.closest("[data-measure-box]")) return;
      event.preventDefault();
      remove(selectedId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const turn = (id: string, by: number) => {
    const item = liveItems.find((i) => i.id === id);
    const s = laidNow.sizes.get(id);
    const frame = laidNow.frames.get(id);
    if (!item || !s || !frame || item.locked) return;
    // (Turned about its middle.)
    const c = localCentre(item, s, unitMap);
    const mid = toWorld(frame, c);
    const a = frame.a + by;
    const o = sub(mid, rot(a, c));
    update(id, { at: { kind: "free", x: o[0], y: o[1], a } });
  };
  // A corner at its joint: its angle in degrees, + in (its fronts towards the other's), − out.
  const jointOf = (item: KitchenItem) => {
    if (item.at.kind !== "attach") return null;
    const at = item.at;
    const parent = liveItems.find((i) => i.id === at.to);
    const socket = parent ? localSockets(parent, 0, unitMap).find((s) => s.id === at.side) : undefined;
    if (!parent || !socket) return null;
    const sign = insideSign(socket.n, socket.f);
    const degrees = at.face ? 90 : Math.round((((at.turn ?? 0) * sign * 180) / Math.PI) * 10) / 10;
    // A new angle, kept: straight — back on its side; else turned about the pivot of what it's run off, and kept where
    // that puts it (a pivot picked after doesn't move it).
    const set = (deg: number) => commitTurn(item, (Math.max(-180, Math.min(180, deg)) * Math.PI * sign) / 180);
    return { parent, side: at.side, plug: laidNow.plug.get(item.id) ?? "", degrees, sign, set };
  };
  // A turn at its joint, kept: where it puts it — about the pivot of what it's run off, as things are now — from where
  // it'd sit straight.
  const commitTurn = (item: KitchenItem, turn: number) => {
    if (item.at.kind !== "attach") return;
    const at = item.at;
    const straightAt = { kind: "attach" as const, to: at.to, side: at.side };
    if (Math.abs(turn) < 1e-6) return update(item.id, { at: straightAt });
    setItems(bakeTurn(liveItems.map((i) => (i.id === item.id ? { ...i, at: { ...straightAt, turn } } : i)), item.id, unitMap, gaps));
  };
  const nameOf = (item: KitchenItem) => {
    const u = item.unitId ? unitMap.get(item.unitId) : item.fronts[0] ? unitMap.get(item.fronts[0]) : undefined;
    return item.kind === "gap" ? `Gap ${item.gapMm ?? 600}mm` : u?.name || (item.kind === "panel" ? "Panel" : "Cabinet");
  };
  // The turn controls: Rotate (drag on the drawing — any angle, snapping every 45°), Straight, and the angle typed — at its
  // joint; on its own, Rotate. Its pivot: its blue dot.
  const cornerControls = (item: KitchenItem) => {
    const joint = jointOf(item);
    const pill = "glass-shine glass-shine-neutral inline-flex h-7 items-center justify-center rounded-full border px-3 text-[11.5px] font-medium";
    if (item.locked) {
      return item.kind === "custom" ? null : (
        <p className="text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
          Locked — switch Lock position off to turn it.
        </p>
      );
    }
    if (!joint) {
      return item.kind === "custom" ? null : (
        <p className="text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
          Turn it with Rotate on the toolbar: drag, or type an angle. It turns about its blue dot (none picked: its front left), and what runs off it turns with it.
        </p>
      );
    }
    return (
      <div className="space-y-2">
        <p className="text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
          {joint
            ? `Turns about ${nameOf(joint.parent)}'s pivot — its blue dot (click one of its corners), else its corner at the joint.${item.kind === "box" && joint.parent.kind === "box" ? ` Fronts' corners kept ${Math.max(laidNow.sizes.get(item.id)?.g ?? gaps.doorGap, laidNow.sizes.get(joint.parent.id)?.g ?? gaps.doorGap)}mm apart at that corner.` : ""}`
            : "Turns about its blue dot (its front left, if none's picked) — what runs off it turns with it."}
        </p>
        <div className="flex items-center gap-1.5">
          {joint ? (
            <button type="button" onClick={() => joint.set(0)} className={pill} style={{ color: "var(--text-main)" }}>
              Straight
            </button>
          ) : null}
        </div>
        {joint ? (
          <label className="flex items-center gap-2 text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
            <span className="flex-1">Angle (in +, out −)</span>
            <MeasureBox
              key={`${item.id}_${joint.degrees}`}
              idle
              active={rotateTool}
              type="number"
              step={1}
              min={-180}
              max={180}
              defaultValue={joint.degrees}
              onBlur={(e) => {
                const deg = Number(e.target.value);
                if (Number.isFinite(deg) && deg !== joint.degrees) joint.set(deg);
              }}
              onKeyDown={(e) => {
                const box = e.target as HTMLInputElement;
                if (e.key === "Enter") box.blur();
                if (e.key === "Escape" && box.dataset.measureBox === "busy") {
                  e.stopPropagation();
                  box.value = String(joint.degrees);
                  box.dataset.measureBox = "idle";
                  box.select();
                }
              }}
              className="h-7 w-[72px] rounded-full border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2.5 text-right text-[12px] font-medium text-[var(--text-main)]"
            />
            <span>°</span>
          </label>
        ) : null}
      </div>
    );
  };
  // What kind of panel it is — auto (from its height), or set.
  // Its options, on or off, one to a row.
  const optionRow = (label: string, hint: string, checked: boolean, onChange: (on: boolean) => void, key = label) => (
    <label key={key} className="flex items-center justify-between gap-2 text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
      <span className="min-w-0">
        {label}
        <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
          {hint}
        </span>
      </span>
      <GlassSwitch size="sm" checked={checked} onChange={onChange} ariaLabel={label} />
    </label>
  );
  const pieceOptions = (item: KitchenItem, size: ItemSize) => {
    const cabinet = item.kind === "box" || item.kind === "custom";
    const hidden = hiddenItems.has(item.id);
    return (
      <div className="mt-3 space-y-2.5 rounded-[12px] border px-3 py-2.5" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
        <Segmented
          value={item.level}
          onChange={(level) => {
            if (item.locked || level === item.level) return;
            // (Up on the wall, or down: on its own from there, where it is, at that level's height — an overhead's lined up
            // with what's there.)
            const to = item.at.kind === "attach" ? item.at.to : "";
            const parent = liveItems.find((i) => i.id === to);
            const next = liveItems.map((c) => (c.id === item.id ? { ...c, level, lift: undefined, ...(parent && parent.level !== level ? { at: freeAt(item.id) } : {}) } : c));
            setItems(lineUpOverhead(next, item.id, unitMap, gaps, true));
          }}
          options={[
            { value: "base", label: "Base" },
            { value: "wall", label: "Wall" },
          ]}
          pill
          fill
          flip
        />
        {cabinet
          ? optionRow("Benchtop", "A bench on top of it.", hasBench(item, size), (on) => update(item.id, { benchOn: on === (item.level === "base" && !size.tall) ? undefined : on }))
          : null}
        {item.kind === "panel" && size.panelAs === "base" && !item.lift
          ? optionRow("Benchtop", "The bench runs over it.", item.benchOn !== false, (on) => update(item.id, { benchOn: on ? undefined : false }))
          : null}
        {cabinet && (item.level === "base" || size.tall)
          ? optionRow("Kick", "The board along the floor under it.", hasKick(item, size), (on) => update(item.id, { kickOn: on ? undefined : false }))
          : null}
        {item.kind === "box" && item.fronts.length
          ? optionRow("Fronts", "See inside it — they stay on it, just not shown.", item.frontsOn !== false, (on) => update(item.id, { frontsOn: on ? undefined : false }))
          : null}
        {optionRow("Show in drawing", "Off: hidden till it's switched back on (the Browser tab lists it).", !hidden, (on) =>
          setHiddenItems((prev) => {
            const next = new Set(prev);
            if (on) next.delete(item.id);
            else next.add(item.id);
            return next;
          }),
        )}
        {optionRow("Lock position", "Can't be dragged, moved, turned or removed.", Boolean(item.locked), (on) => update(item.id, { locked: on || undefined }))}
      </div>
    );
  };
  const panelKindControl = (item: KitchenItem) =>
    item.kind === "panel" ? (
      <div className="space-y-1.5">
        {/* Face panel: turned in across the front, corner to corner with what it's run off — or back straight. */}
        <label className="mb-1 flex items-center justify-between gap-2 text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
          <span>
            Face panel
            <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
              {item.at.kind === "attach"
                ? `Across the front, corner to corner with ${nameOf(liveItems.find((i) => i.id === (item.at.kind === "attach" ? item.at.to : "")) ?? item)}.`
                : "Run it off a cabinet first."}
            </span>
          </span>
          <GlassSwitch
            size="sm"
            checked={item.at.kind === "attach" && Boolean(item.at.face)}
            onChange={(on) => {
              if (item.at.kind !== "attach") return;
              update(item.id, { at: on ? { kind: "attach", to: item.at.to, side: item.at.side, face: true } : { kind: "attach", to: item.at.to, side: item.at.side } });
            }}
            ariaLabel="Face panel"
          />
        </label>
        {/* Its height and width the other way round from how it's laid by itself. */}
        <label className="mb-1 flex items-center justify-between gap-2 text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
          <span>
            Turn it
            <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
              {`${Math.round(laidNow.sizes.get(item.id)?.height ?? 0)} high × ${Math.round(laidNow.sizes.get(item.id)?.depth ?? 0)} — height and width swapped.`}
            </span>
          </span>
          <GlassSwitch size="sm" checked={Boolean(item.turned)} onChange={(on) => update(item.id, { turned: on || undefined })} ariaLabel="Turn it" />
        </label>
        <p className="text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
          Panel type{item.panelKind && item.panelKind !== "auto" ? "" : ` — auto: ${laidNow.sizes.get(item.id)?.panelAs === "tall" ? "tall" : laidNow.sizes.get(item.id)?.panelAs === "wall" ? "wall" : "under the bench"}`}
        </p>
        <Segmented
          value={item.panelKind ?? "auto"}
          onChange={(panelKind) => update(item.id, { panelKind })}
          options={[
            { value: "auto", label: "Auto" },
            { value: "base", label: "Bench" },
            { value: "tall", label: "Tall" },
            { value: "wall", label: "Wall" },
          ]}
          pill
          fill
          flip
        />
      </div>
    ) : null;
  // A gap left beside it: on that side — what was there moving along past it.
  const [gapDraft, setGapDraft] = useState("600");
  const addGap = (item: KitchenItem, side: "left" | "right") => {
    const mm = Math.round(Number(gapDraft));
    if (!Number.isFinite(mm) || mm <= 0) return;
    const gap: KitchenItem = { id: newId(), level: item.level, kind: "gap", layout: "side", fronts: [], gapMm: mm, gapBench: true, at: { kind: "free", x: 0, y: 0, a: 0 } };
    // (Where it'd go run off that side — then left there, a piece of its own.)
    const target: DropTarget =
      item.at.kind === "attach" && laidNow.plug.get(item.id) === side ? { kind: "attach", to: item.at.to, side: item.at.side } : { kind: "attach", to: item.id, side };
    const placed = applyTarget(liveItems, gap, target, item.level, unitMap);
    const frame = layoutKitchen(placed, unitMap, gaps).frames.get(gap.id);
    setItems([...liveItems, { ...gap, at: frame ? { kind: "free", x: frame.o[0], y: frame.o[1], a: frame.a } : gap.at }]);
    setSelectedId(gap.id);
    setMenu(null);
  };
  const gapControls = (item: KitchenItem) =>
    item.kind === "custom" ? null : (
      <div className="space-y-1.5">
        <p className="text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
          Leave a gap — a dishwasher&apos;s, a fridge&apos;s
        </p>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            step={1}
            value={gapDraft}
            onChange={(e) => setGapDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            className="h-7 w-[76px] rounded-full border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2.5 text-right text-[12px] font-medium text-[var(--text-main)]"
            aria-label="Gap width (mm)"
          />
          <span className="text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
            mm
          </span>
          <button type="button" onClick={() => addGap(item, "left")} className="glass-shine glass-shine-neutral inline-flex h-7 flex-1 items-center justify-center rounded-full border text-[11.5px] font-medium" style={{ color: "var(--text-main)" }}>
            On its left
          </button>
          <button type="button" onClick={() => addGap(item, "right")} className="glass-shine glass-shine-neutral inline-flex h-7 flex-1 items-center justify-center rounded-full border text-[11.5px] font-medium" style={{ color: "var(--text-main)" }}>
            On its right
          </button>
        </div>
      </div>
    );
  // A gap's own: its width, and whether the bench runs over it.
  const gapSettings = (item: KitchenItem) =>
    item.kind === "gap" ? (
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
          <span className="flex-1">Gap width</span>
          <input
            key={`${item.id}_${item.gapMm}`}
            type="number"
            min={1}
            step={1}
            defaultValue={item.gapMm ?? 600}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              const mm = Math.round(Number(e.target.value));
              if (Number.isFinite(mm) && mm > 0 && mm !== item.gapMm) update(item.id, { gapMm: mm });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="h-7 w-[84px] rounded-full border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2.5 text-right text-[12px] font-medium text-[var(--text-main)]"
          />
          <span>mm</span>
        </label>
        {item.level === "base" ? (
          <label className="flex items-center justify-between gap-2 text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
            <span>
              Bench over it
              <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                Off for a fridge that stands on its own.
              </span>
            </span>
            <GlassSwitch size="sm" checked={item.gapBench !== false} onChange={(on) => update(item.id, { gapBench: on })} ariaLabel="Bench over it" />
          </label>
        ) : null}
      </div>
    ) : null;
  const menuItem = menu ? liveItems.find((i) => i.id === menu.id) ?? null : null;
  // Its pivot's two corners on the drawing (on what it's run off, at its top) — clicked to pick one.
  // The dots on the drawing (at each piece's top): each piece's pivot, blue — and the picked one's corners, all of them
  // (bigger), to pick from. With no pivot picked, none's blue; Rotate rings the corner it'd turn about (`fallback`). The
  // pivots last, so on top: a click on a spot two dots share gets the pivot, not the plain corner over it.
  const allDots = (() => {
    if (moving || dropPreview || rotating || typedTurn || tool === "measure" || tool === "extrude") return [];
    const projector = cabinetViewProjector(model, view, size);
    return liveItems.flatMap((item) => {
      const f = laidNow.frames.get(item.id);
      const s2 = laidNow.sizes.get(item.id);
      const print = s2 ? footprintOf(item, s2) : null;
      if (!f || !s2 || !print) return [];
      if (partHidden(`item:${item.id}:carcass`)) return [];
      const picked = item.id === selectedId;
      const pivot = item.pivot ?? null;
      const turnsAbout = picked && tool === "rotate" && !item.pivot && item.at.kind === "free" ? ownPivotOf(item) : null;
      // (A dot at every corner, top and bottom: when it's picked, or a dot's being dragged, somewhere to drop it. Otherwise
      // just its pivot, if it has one.)
      const hasLow = item.kind === "box" || item.kind === "custom" || item.kind === "panel";
      return ([0, 1] as const).flatMap((x) =>
        ([0, 1] as const).flatMap((y) => {
          const onCorner = Boolean(pivot && pivot.x === x && pivot.y === y);
          const onLow = onCorner && hasLow && Boolean(pivot?.low);
          const isPivot = onCorner && !onLow;
          const at = toWorld(f, footprintCorner(print, { x, y }));
          const low = hasLow && (picked || onLow || pivotDrag) ? (() => {
            const [sx, sy] = projector.project([at[0], at[1], lowOf(item, s2, kickOf(gaps)) - 2]);
            return [{ key: `${item.id}_${x}${y}_low`, ref: { id: item.id, corner: { x, y } as Pivot, low: true }, x: sx, y: sy, picked, pivot: onLow, fallback: false }];
          })() : [];
          if (!picked && !isPivot && !pivotDrag) return low;
          const [sx, sy] = projector.project([at[0], at[1], s2.z0 + s2.height + (s2.bench ? BENCH_MM : 0) + 2]);
          const fallback = Boolean(turnsAbout && turnsAbout.x === x && turnsAbout.y === y);
          const up = { key: `${item.id}_${x}${y}`, ref: { id: item.id, corner: { x, y } as Pivot }, x: sx, y: sy, picked, pivot: isPivot, fallback };
          // (Lying flat, the two nearly on each other: its top the one that's pressed.)
          return s2.height < THIN_MM ? [...low, up] : [up, ...low];
        }),
      );
    }).sort((a, b) => Number(a.pivot) - Number(b.pivot));
  })();
  // The dot nearest the pointer (within a little of it), while one's dragged — another piece's before its own, which is
  // often right beside the one it's being lined up with; its own only with no other there.
  const dotNear = (clientX: number, clientY: number, own: string): CornerRef | null => {
    const point = svgPoint(clientX, clientY);
    if (!point) return null;
    let best: { ref: CornerRef; d: number } | null = null;
    let bestOwn: { ref: CornerRef; d: number } | null = null;
    for (const dot_ of allDots) {
      const d = len(sub([dot_.x, dot_.y], point)) * zoom.z;
      if (d >= 30) continue;
      if (dot_.ref.id === own) {
        if (!bestOwn || d < bestOwn.d) bestOwn = { ref: dot_.ref, d };
      } else if (!best || d < best.d) best = { ref: dot_.ref, d };
    }
    return best?.ref ?? bestOwn?.ref ?? null;
  };
  // A dot let go: onto another piece's — this piece moved so its corner's on that one (turned as it is, what runs off it
  // with it, no longer run off anything — and that one, if it ran off this, left where it is, or it'd move with it), both
  // corners now their pivots (a thin panel onto a bottom corner: its top, whichever of its dots it was — up against that
  // underside, not sunk into it); onto one of its own, or just clicked — its pivot; its pivot clicked — let go, with any other
  // on that spot (and what's picked left as it was). Up or down as well, whatever they are, so the corners truly meet — and
  // what runs off it with it.
  const dropCorner = (from: CornerRef, onto: CornerRef | null) => {
    if (!onto) return;
    const item = liveItems.find((i) => i.id === from.id);
    if (!item) return;
    // (Locked: its corners can still be its pivot, but it's not going anywhere.)
    if (item.locked && onto.id !== from.id) return;
    if (onto.id === from.id) {
      const already = Boolean(item.pivot && item.pivot.x === onto.corner.x && item.pivot.y === onto.corner.y && Boolean(item.pivot.low) === Boolean(onto.low));
      if (already && sameRef(onto, from)) {
        const here = allDots.find((d) => sameRef(d.ref, from));
        const letGo = new Set([item.id]);
        if (here) for (const d of allDots) if (d.pivot && len(sub([d.x, d.y], [here.x, here.y])) * zoom.z < 4) letGo.add(d.ref.id);
        setItems((prev) => prev.map((c) => (letGo.has(c.id) ? { ...c, pivot: undefined } : c)));
        return;
      }
      setSelectedId(item.id);
      update(item.id, { pivot: { x: onto.corner.x, y: onto.corner.y, ...(onto.low ? { low: true } : {}) } });
      return;
    }
    setSelectedId(item.id);
    const other = liveItems.find((i) => i.id === onto.id);
    if (!other) return;
    if (from.low && onto.low && (laidNow.sizes.get(item.id)?.height ?? THIN_MM) < THIN_MM) from = { id: from.id, corner: from.corner };
    const carriedAlong = descendants(liveItems, item.id).has(other.id);
    const af = laidNow.frames.get(other.id);
    const as = laidNow.sizes.get(other.id);
    const bf = laidNow.frames.get(item.id);
    const bs = laidNow.sizes.get(item.id);
    const ap = as ? footprintOf(other, as) : null;
    const bp = bs ? footprintOf(item, bs) : null;
    if (!af || !bf || !ap || !bp) return;
    const target = toWorld(af, footprintCorner(ap, onto.corner));
    const o = add(bf.o, sub(target, toWorld(bf, footprintCorner(bp, from.corner))));
    let next = liveItems.map((i) =>
      i.id === item.id
        ? { ...i, pivot: { x: from.corner.x, y: from.corner.y, ...(from.low ? { low: true } : {}) }, at: { kind: "free" as const, x: o[0], y: o[1], a: bf.a } }
        : i.id === other.id
          ? { ...i, pivot: { x: onto.corner.x, y: onto.corner.y, ...(onto.low ? { low: true } : {}) }, at: carriedAlong ? freeAt(other.id) : i.at }
          : i,
    );
    const laidNext = layoutKitchen(next, unitMap, gaps);
    const zOf = (ref: CornerRef) => {
      const sz = laidNext.sizes.get(ref.id);
      const of = next.find((i) => i.id === ref.id);
      return sz && of ? (ref.low ? lowOf(of, sz, kickOf(gaps)) : sz.z0 + sz.height) : null;
    };
    const want = zOf(onto);
    const have = zOf(from);
    if (want !== null && have !== null && Math.abs(want - have) > 0.5) {
      // (Never through the floor: down as far as that, and no further.)
      const own = laidNext.sizes.get(item.id);
      const by = Math.max(want - have, own ? -lowOf(next.find((i) => i.id === item.id) ?? item, own, kickOf(gaps)) : want - have);
      const carried = descendants(next, item.id);
      // (A panel at bench or overhead height run off it follows by itself.)
      next = next.map((i) => (i.id === item.id || (carried.has(i.id) && (i.kind !== "panel" || laidNext.sizes.get(i.id)?.tall)) ? { ...i, lift: (i.lift ?? 0) + by } : i));
    }
    setItems(next);
  };
  const setPieceOn = (unitId: string, key: string, on: boolean) =>
    setOffPieces((prev) => {
      const now = new Set(prev[unitId] ?? []);
      if (on) now.delete(key);
      else now.add(key);
      return { ...prev, [unitId]: Array.from(now) };
    });

  const drawn = useMemo(
    () =>
      // (The floor first, always — everything's on it; by the middle of its faces it can sort in front of what's on it.)
      [...projected.filter((face) => face.part.startsWith("room:")), ...projected.filter((face) => !face.part.startsWith("room:"))].map((face) => {
        const itemId = itemOfPart(face.part);
        const room = face.part.startsWith("room:");
        const picked = Boolean(selectedId) && itemId === selectedId;
        const target = Boolean(itemId) && ((dropPreview?.target.kind === "into" && dropPreview.target.itemId === itemId) || moving?.id === itemId);
        const hovered = !picked && Boolean(hoverPart) && hoverPart === itemId;
        const base = colors.get(face.part) ?? CARCASS;
        const shaded = mixCabinetColor(base, "#0F172A", (1 - face.light) * 0.32);
        const fill = picked || target ? mixCabinetColor(shaded, "#2563EB", 0.28) : hovered ? mixCabinetColor(shaded, "#2563EB", 0.12) : shaded;
        const see = translucentParts.has(face.part);
        const isGhost = itemId === GHOST_ID;
        return {
          key: face.key,
          points: face.screen.map((p) => `${Math.round(p[0] * 10) / 10},${Math.round(p[1] * 10) / 10}`).join(" "),
          fill,
          room,
          fillOpacity: isGhost ? 0.3 : room ? 0.45 : see ? 0.35 : xray ? 0.28 : 1,
          stroke: picked || isGhost ? "#1D4ED8" : room ? "#475569" : "#000000",
          strokeOpacity: room ? 0.18 : picked || isGhost ? 0.9 : 0.85,
          dash: see ? "4 3" : undefined,
        };
      }),
    [colors, dropPreview, hoverPart, moving, projected, selectedId, translucentParts, xray],
  );

  const hint = (() => {
    if (rotating) {
      const item = liveItems.find((i) => i.id === rotating.id);
      const joint = item ? jointOf(item) : null;
      if (rotating.free) return `${Math.round((((rotating.free.a * 180) / Math.PI) % 360 + 360) % 360)}°`;
      const deg = Math.round(((rotating.turn ?? 0) * (joint?.sign ?? 1) * 180) / Math.PI);
      return deg === 0 ? "Straight" : `${deg > 0 ? "In" : "Out"} ${Math.abs(deg)}°`;
    }
    if (turnTyped) return `Turn ${turnTyped.deg}° — Enter to keep it`;
    if (draft?.delta) return `Move ${moveAxis.toUpperCase()}: ${draft.delta} mm — Enter to lock it in`;
    const t = moving?.target ?? dropPreview?.target;
    if (!t) return "";
    if (t.kind === "into") return t.behind ? "Put behind these fronts" : t.place ? { above: "Above it", below: "Below it", left: "Left of it", right: "Right of it" }[t.place.side] : "Add to this cabinet";
    if (t.kind === "attach") return isKickSide(t.side) ? `On the kick, ${t.side === "kick-left" ? "left" : "right"} end` : t.insert ? "In between" : "Next to it";
    if (t.wall) return "Against the wall";
    if (t.aligned) return "In line with the run";
    return (moving?.level ?? dropPreview?.level) === "wall" ? "On its own — wall" : "On its own — base";
  })();
  const endDrop = () => {
    setDropPreview(null);
    setHoverPart(null);
  };
  // A library piece dragged: over the drawing — where it'd go, shown; let go there — in it goes. Anywhere else, nothing.
  const overDrawing = (x: number, y: number) => {
    const box = hostRef.current?.getBoundingClientRect();
    return Boolean(box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);
  };
  const libDragMove = (event: PointerEvent) => {
    const held = libDragRef.current;
    if (!held || event.pointerId !== held.pointerId) return;
    const started = held.started || Math.hypot(event.clientX - held.x0, event.clientY - held.y0) > 5;
    if (!started) return;
    const next_ = { ...held, x: event.clientX, y: event.clientY, started: true };
    libDragRef.current = next_;
    setLibDrag(next_);
    const u = unitMap.get(held.unitId);
    if (!u || !overDrawing(event.clientX, event.clientY)) {
      if (dropPreview) endDrop();
      return;
    }
    if (!heldBounds) setHeldBounds(model.bounds);
    const ghost = itemFor(u, levelFor(u, placing), GHOST_ID);
    const found = targetAt(event.clientX, event.clientY, ghost, u, liveItems);
    const next = { unitId: u.id, level: found.level, target: inLine({ ...ghost, level: found.level }, found.target, liveItems) };
    setDropPreview((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  };
  const libDragUp = (event: PointerEvent) => {
    const held = libDragRef.current;
    if (!held || event.pointerId !== held.pointerId) return;
    const preview = dropPreview;
    libDragRef.current = null;
    setLibDrag(null);
    endDrop();
    const u = unitMap.get(held.unitId);
    if (!held.started || !u || event.type !== "pointerup" || !overDrawing(event.clientX, event.clientY)) return;
    const ghost = itemFor(u, levelFor(u, placing), GHOST_ID);
    const found = preview && preview.unitId === u.id ? preview : targetAt(event.clientX, event.clientY, ghost, u, liveItems);
    const level = found.level;
    const target = preview && preview.unitId === u.id ? preview.target : inLine({ ...ghost, level }, found.target, liveItems);
    commitUnit(u, withDragTurn({ ...ghost, level }, target), level);
  };
  useEffect(() => {
    libHandlersRef.current = { move: libDragMove, up: libDragUp };
  });
  const unitText = (u: KitchenUnit) => {
    if (u.kind === "fronts") {
      if (u.fronts.length === 1) return `${u.fronts[0].height} × ${u.fronts[0].width} · ${u.fronts[0].thicknessMm}mm`;
      return u.layout === "stack"
        ? `${u.fronts.length} stacked: ${u.fronts.map((f) => f.height).join(" / ")} × ${Math.max(...u.fronts.map((f) => f.width))}`
        : `${u.fronts.length} side by side: ${Math.max(...u.fronts.map((f) => f.height))} × ${u.fronts.map((f) => f.width).join(" + ")}`;
    }
    if (u.kind === "cabinet") return `${u.height} × ${u.width} × ${u.depth}${u.subUnits.length ? ` · ${u.subUnits.length} sub part${u.subUnits.length === 1 ? "" : "s"}` : ""}`;
    if (u.kind === "custom") return `Custom cabinet · ${u.height} high`;
    if (u.kind === "panel" && !(u.height > 0) && u.width > 0 && u.depth > 0) return `Flat · ${u.width} × ${u.depth} · ${u.thicknessMm}mm`;
    if (!(u.height > 0 && u.width > 0)) return "No size yet — not placed";
    return `${u.height} × ${u.width} · ${u.thicknessMm}mm`;
  };
  const selectedTitle = selected
    ? selected.kind === "panel"
      ? "Panel"
      : selected.kind === "gap"
        ? "Gap"
      : selected.kind === "custom"
        ? "Custom cabinet"
        : `${isExisting(selected) ? "Existing " : ""}${selectedSize?.tall ? "tall" : selected.level === "wall" ? "wall" : "base"} cabinet`
    : "";
  const cabinetPieces = selectedUnit?.kind === "cabinet" ? kitchenCabinetryPieces(selectedUnit) : [];
  const piecesOff = new Set(selectedUnit ? offPieces[selectedUnit.id] ?? [] : []);

  // The measurement as it stands: its points, the next following the pointer till it's finished.
  const measurePoints: Point3[] = measure ? (measure.done || !measureHover ? measure.points : [...measure.points, measureHover.p]) : [];
  const measureLength = (a: Point3, b: Point3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const measureAngle =
    measurePoints.length >= 3
      ? (() => {
          const [a, m, b] = measurePoints;
          const u1: Point3 = [a[0] - m[0], a[1] - m[1], a[2] - m[2]];
          const u2: Point3 = [b[0] - m[0], b[1] - m[1], b[2] - m[2]];
          const lengths = Math.hypot(...u1) * Math.hypot(...u2);
          return lengths > 0 ? (Math.acos(Math.max(-1, Math.min(1, (u1[0] * u2[0] + u1[1] * u2[1] + u1[2] * u2[2]) / lengths))) * 180) / Math.PI : 0;
        })()
      : null;
  // Face to face: the second face (or the one under the pointer, till it's clicked), and what they come to, always square
  // to them. Facing the same way, the one standing further out is the one whose line's carried across: measured at the
  // other — `from` on it, `to` on the further one's line, `carriedFrom` where that line leaves its face. Looking up and
  // down at side faces, it's measured at a height they share, if they do, so the line carried across stays level. Not
  // parallel: square to the second, from the point on the first.
  const faceSecond = faceMeasure
    ? (faceMeasure.b ??
      (faceHover && faceHover.key !== faceMeasure.a.key
        ? faceHover
        : measureHover
          ? { key: "point", points: [measureHover.p], n: faceMeasure.a.n, at: measureHover.p }
          : null))
    : null;
  const faceResult = (() => {
    if (!faceMeasure || !faceSecond) return null;
    const dot3 = (p: Point3, q: Point3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const gap = (p: Point3, q: Point3): Point3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const cosine = dot3(faceMeasure.a.n, faceSecond.n);
    const parallel = Math.abs(cosine) > 0.9995;
    const firstToSecond = dot3(gap(faceSecond.at, faceMeasure.a.at), faceMeasure.a.n);
    // (`near`: where it's measured. `far`: whose line's carried across.)
    const swap = parallel && cosine > 0 && firstToSecond < 0;
    const near = swap ? faceSecond : faceMeasure.a;
    const far = swap ? faceMeasure.a : faceSecond;
    const along: Point3 = parallel ? near.n : far.n;
    let start: Point3 = [...near.at];
    // (At an angle: from its corner nearest the other's plane, wherever it was clicked.)
    if (!parallel) {
      start = near.points.reduce<Point3>((best, q) => (Math.abs(dot3(gap(far.at, q as Point3), along)) < Math.abs(dot3(gap(far.at, best), along)) ? (q as Point3) : best), near.points[0] as Point3);
    }
    if (parallel && Math.abs(near.n[2]) < 0.5) {
      const zs = (face: MeasureFace) => face.points.map((q) => q[2]);
      const low = Math.max(Math.min(...zs(near)), Math.min(...zs(far)));
      const high = Math.min(Math.max(...zs(near)), Math.max(...zs(far)));
      if (low <= high) start[2] = Math.max(low, Math.min(high, start[2]));
    }
    const signed = dot3(gap(far.at, start), along);
    const to: Point3 = [start[0] + along[0] * signed, start[1] + along[1] * signed, start[2] + along[2] * signed];
    const carriedFrom = far.points.length < 3 ? far.at : nearestOnFace(far.points, far.n, to);
    return { distance: Math.abs(signed), from: start, to, carriedFrom, parallel, angle: (Math.acos(Math.min(1, Math.abs(cosine))) * 180) / Math.PI };
  })();
  const fmtMm = (mm: number) => `${(Math.round(mm * 10) / 10).toLocaleString()} mm`;
  const drawProjector = cabinetViewProjector(model, view, size);
  // The floor's grid: a line each 500mm, stronger each metre.
  const gridLines = (() => {
    const floor = model.prisms.find((prism) => prism.part === "room:floor");
    if (!floor || !showGrid || hiddenLayers.has("floor")) return [];
    const xs = floor.polygon.map((q) => q[0]);
    const ys = floor.polygon.map((q) => q[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const step = 500;
    const lines: Array<{ key: string; a: number[]; b: number[]; major: boolean }> = [];
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) lines.push({ key: `x${x}`, a: drawProjector.project([x, y0, 0]), b: drawProjector.project([x, y1, 0]), major: x % 1000 === 0 });
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) lines.push({ key: `y${y}`, a: drawProjector.project([x0, y, 0]), b: drawProjector.project([x1, y, 0]), major: y % 1000 === 0 });
    return lines;
  })();
  // The size of what's picked, drawn along its edges (Dimensions on).
  const dimLines = (() => {
    if (!showDims || !selected) return [];
    const f = laid.frames.get(selected.id);
    const sz = laid.sizes.get(selected.id);
    const print = sz ? footprintOf(selected, sz) : null;
    if (!f || !sz || !print) return [];
    const top = sz.z0 + sz.height;
    const c = (x: number, y: number) => toWorld(f, [x, y]);
    const fl = c(print.x0, print.y1);
    const fr = c(print.x1, print.y1);
    const bl = c(print.x0, print.y0);
    const line = (a: Point3, b: Point3) => ({ a: drawProjector.project(a), b: drawProjector.project(b), label: `${Math.round(measureLength(a, b))}` });
    return [line([fl[0], fl[1], sz.z0], [fr[0], fr[1], sz.z0]), line([fl[0], fl[1], sz.z0], [fl[0], fl[1], top]), line([fl[0], fl[1], top], [bl[0], bl[1], top])];
  })();
  // The bench's face picked, as it is with how far it's gone so far, and where its arrow goes.
  const extrudeShape = (() => {
    if (!extrude) return null;
    const { face, dist } = extrude;
    const frame = laid.frames.get(face.anchor);
    const out = face.kind === "side" && face.n && frame ? rot(frame.a, face.n) : ([0, 0] as Vec);
    const rise = face.kind === "top" ? dist : face.kind === "bottom" ? -dist : 0;
    const moved = face.points.map((q): Point3 => [q[0] + out[0] * dist, q[1] + out[1] * dist, q[2] + rise]);
    const mid = moved.reduce<Point3>((sum, q) => [sum[0] + q[0] / moved.length, sum[1] + q[1] / moved.length, sum[2] + q[2] / moved.length], [0, 0, 0]);
    const start = drawProjector.project(mid) as Vec;
    const tipAt: Point3 = face.kind === "side" ? [mid[0] + out[0] * 200, mid[1] + out[1] * 200, mid[2]] : [mid[0], mid[1], mid[2] + (face.kind === "top" ? 200 : -200)];
    const dir = unit(sub(drawProjector.project(tipAt) as Vec, start));
    return { points: moved.map((q) => drawProjector.project(q) as Vec), start, dir };
  })();
  const hoveredFace = tool === "extrude" && extrudeHover && extrude?.face.key !== extrudeHover ? projected.find((face) => face.key === extrudeHover) : undefined;
  const statusText = (() => {
    if (navTool === "orbit") return "Orbit: drag to turn the view";
    if (navTool === "pan") return "Pan: drag to move the view";
    if (tool === "measure") {
      if (!snapOn) return !measure || measure.done ? "Measure: click anywhere (Snap is off)" : measure.points.length === 1 ? "Measure: click the second point" : "Measure: click a third point for an angle, or right-click to finish";
      if (faceMeasure && !faceMeasure.b) return "Measure: click another face, a corner or an edge — they needn't line up";
      if (measure && !measure.done) return measure.points.length === 1 ? "Measure: click a second point, or a face" : "Measure: click a third point for an angle, or right-click to finish";
      return "Measure: click a corner or an edge for a point, or the middle of a face for that face";
    }
    if (tool === "extrude") return extrude ? "Extrude: drag the face or type a distance, then Enter" : "Extrude: click a face of the benchtop";
    if (tool === "move") return selected ? "Move: drag an arrow, or type a distance, then Enter" : "Move: click a piece";
    if (tool === "rotate") return selected ? "Rotate: drag on the drawing (snaps every 45°), or type an angle, then Enter" : "Rotate: click a piece";
    if (pieceInHand) return `Let go to place it — Ctrl + scroll turns it${dragTurn ? ` (${Math.round((((dragTurn * 180) / Math.PI) % 360 + 360) % 360)}°)` : ""}`;
    if (selected && selectedSize) return `${nameOf(selected)}  ${Math.round(selectedSize.width)} × ${Math.round(selectedSize.height)} × ${Math.round(selectedSize.depth)}`;
    return "Drag a piece onto a face, or onto the floor. Right-click a piece for its options.";
  })();
  const LAYERS: Array<[DrawLayer, string]> = [
    ["base", "Base cabinets"],
    ["wall", "Overheads"],
    ["fronts", "Fronts"],
    ["bench", "Benchtop"],
    ["kicks", "Kicks"],
    ["floor", "Floor and grid"],
  ];
  const propsShown = Boolean(selected && selectedSize && !propsFolded && tool !== "extrude" && tool !== "measure");
  const floatingPanelClass =
    "hide-native-scrollbar absolute right-3 top-[104px] z-20 flex max-h-[calc(100%-116px)] w-[272px] flex-col overflow-y-auto rounded-[12px] border p-3 shadow-lg max-lg:inset-x-2 max-lg:bottom-2 max-lg:top-auto max-lg:max-h-[55%] max-lg:w-auto";
  const floatingPanelStyle = { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" };

  return (
    <div
      // (A finger dragged on the drawing is working on it: never the phone's pull-down menu, which would also fade this
      // screen's top bar — or a swipe open of the menu or Notifications.)
      data-app-gesture-exempt="true"
      className="flex h-[100svh] flex-col bg-[var(--bg-app)]"
      onPointerDownCapture={() => {
        // (Whatever's about to change, the view stays where it is. Fit lets it go again.)
        if (!heldBounds) setHeldBounds(model.bounds);
      }}
    >
      {undoWarning.element}
      {/* The library piece being dragged, following the pointer. */}
      {libDrag?.started
        ? (() => {
            const u = unitMap.get(libDrag.unitId);
            return u ? (
              <div
                className="pointer-events-none fixed z-[60] max-w-[220px] truncate rounded-full border px-3 py-1 text-[12px] font-medium shadow-lg"
                style={{ left: libDrag.x + 14, top: libDrag.y + 12, borderColor: mixCabinetColor(u.color, "#0F172A", 0.2), backgroundColor: mixCabinetColor(u.color, "#FFFFFF", 0.6), color: "#0F172A" }}
              >
                {u.name || u.partType}
              </div>
            ) : null;
          })()
        : null}
      {/* The top bar, as the other Production screens' (CNC Cutlist's): its glass a fixed layer of its own, held steady, with
          what's on it fixed over that, and room left for them above the toolbar. */}
      <div
        data-app-top-bar="true"
        className="pointer-events-none fixed left-0 right-0 top-0 z-[90] h-[56px]"
        style={{
          backgroundColor: "var(--glass-bg-strong)",
          backdropFilter: "blur(14px) saturate(220%)",
          WebkitBackdropFilter: "blur(14px) saturate(220%)",
          transform: "translateZ(0)",
          WebkitTransform: "translateZ(0)",
          willChange: "transform",
        }}
      />
      <div aria-hidden="true" className="h-[56px] shrink-0" />
      <div
        data-app-top-bar-content="true"
        className="fixed left-0 right-0 top-0 z-[100] flex h-[56px] items-center gap-3 px-3 md:px-5"
        style={{ color: "var(--text-main)" }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
          <Box size={15} className="shrink-0" />
          <span>Drawing</span>
          <span style={{ color: "var(--text-muted)" }}>|</span>
          <span className="truncate">{projectName}</span>
          {/* How it stands with the project: saved, saving — or can't be. */}
          <span
            className="ml-1 shrink-0 rounded-full px-2.5 py-[3px] text-[11px] font-semibold normal-case tracking-normal"
            style={
              saveState === "error" || saveState === "failed" || readOnly
                ? { backgroundColor: "color-mix(in srgb, #D97706 16%, transparent)", color: "#B45309" }
                : { backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }
            }
            title={readOnly ? "You can't change this project — changes here aren't saved" : saveState === "failed" ? "The saved drawing couldn't be read — nothing here is saved over it" : undefined}
          >
            {readOnly
              ? "View only · not saved"
              : saveState === "loading"
                ? "Loading…"
                : saveState === "failed"
                  ? "Couldn't load · not saved"
                  : saveState === "saving"
                    ? "Saving…"
                    : saveState === "error"
                      ? "Not saved — tries again on the next change"
                      : "Saved"}
          </span>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="glass-shine inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium text-white hover:brightness-95"
          style={glassShineStyle("#16A34A")}
        >
          <ArrowLeft size={15} />
          Back
        </button>
      </div>

      {/* The toolbar: icons in groups, each named under it. */}
      <div className="hide-native-scrollbar flex shrink-0 items-stretch overflow-x-auto border-b px-1.5 py-1" style={{ backgroundColor: "var(--panel-bg)", borderColor: "var(--glass-border)" }}>
        <ToolGroup label="Edit">
          <ToolButton icon={Undo2} label="Undo" keys="Ctrl+Z" onClick={undo} />
          <ToolButton icon={Redo2} label="Redo" keys="Ctrl+Y" onClick={redo} />
        </ToolGroup>
        <ToolGroup label="Select">
          <ToolButton icon={MousePointer2} label="Select" keys="V" active={tool === "select"} onClick={() => chooseTool("select")} />
        </ToolGroup>
        <ToolGroup label="Modify">
          <ToolButton icon={Move3d} label="Move" keys="M" active={tool === "move"} onClick={() => chooseTool("move")} />
          <ToolButton icon={RotateCw} label="Rotate" keys="R" active={tool === "rotate"} onClick={() => chooseTool("rotate")} />
          <ToolButton icon={ArrowUpFromLine} label="Extrude a benchtop face" keys="E" active={tool === "extrude"} onClick={() => chooseTool("extrude")} />
          <ToolButton
            icon={Link2Off}
            label="Unhook what's picked, so it stays put on its own"
            disabled={!selected || selected.at.kind !== "attach"}
            onClick={() => selected && update(selected.id, { at: freeAt(selected.id) })}
          />
          <ToolButton icon={Trash2} label="Remove what's picked" keys="Delete" disabled={!selected} onClick={() => selected && remove(selected.id)} />
        </ToolGroup>
        <ToolGroup label="Inspect">
          <ToolButton icon={Ruler} label="Measure — between points, faces, or a point and a face (3 points for an angle)" keys="I" active={tool === "measure"} onClick={() => chooseTool("measure")} />
          <ToolButton icon={Magnet} label="Snap: measuring locks to corners and edges, and dragged pieces snap to sides" active={snapOn} onClick={() => setSnapOn((on) => !on)} />
          <ToolButton icon={Scaling} label="Show the size of what's picked" active={showDims} onClick={() => setShowDims((on) => !on)} />
        </ToolGroup>
        <ToolGroup label="View">
          <ToolButton icon={Home} label="Home view" keys="H" onClick={goHome} />
          <ToolButton icon={Maximize} label="Fit everything in view" keys="F" onClick={fitView} />
          <ToolButton icon={Grid3x3} label="Grid" active={showGrid} onClick={() => setShowGrid((on) => !on)} />
          <ToolButton icon={Scan} label="See through" active={xray} onClick={() => setXray((on) => !on)} />
          <ToolButton
            icon={Eye}
            label="What's shown"
            active={Boolean(showMenuAt) || hiddenLayers.size > 0}
            onClick={() => {
              const box = document.querySelector(`[aria-label="What's shown"]`)?.getBoundingClientRect();
              setShowMenuAt((open) => (open || !box ? null : { left: box.left, top: box.bottom + 18 }));
            }}
          />
        </ToolGroup>
        <ToolGroup label="Drop level">
          <ToolButton icon={PanelBottom} label="A front or panel dropped on the floor is a base one" active={placing === "base"} onClick={() => setPlacing("base")} />
          <ToolButton icon={PanelTop} label="A front or panel dropped on the floor is an overhead" active={placing === "wall"} onClick={() => setPlacing("wall")} />
        </ToolGroup>
        <ToolGroup label="Settings" last>
          <ToolButton icon={Settings2} label="Benchtop overhangs and gaps" active={settingsOpen} onClick={() => setSettingsOpen((open) => !open)} />
          <ToolButton
            icon={Eraser}
            label="Clear the drawing"
            disabled={!liveItems.length}
            onClick={() => {
              if (!window.confirm("Clear the drawing? Everything in it is taken out (Ctrl+Z puts it back).")) return;
              setItems([]);
              setExtrusions([]);
              setSelectedId(null);
              setMenu(null);
            }}
          />
        </ToolGroup>
      </div>
      {showMenuAt ? (
        <div className="fixed z-40 w-[190px] rounded-[10px] border p-1.5 shadow-lg" style={{ ...floatingPanelStyle, left: showMenuAt.left, top: showMenuAt.top }}>
          {LAYERS.map(([layer, label]) => (
            <label key={layer} className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-[12px] font-medium hover:bg-[var(--panel-muted)]" style={{ color: "var(--text-main)" }}>
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--brand)]"
                checked={!hiddenLayers.has(layer)}
                onChange={(e) =>
                  setHiddenLayers((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.delete(layer);
                    else next.add(layer);
                    return next;
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 max-lg:flex-col-reverse">
        {/* The library: the cutlist's pieces, by part type — dragged onto the drawing, or + (onto what's picked, or after
            the last one) — and the browser: what's in the drawing. */}
        <aside className="flex w-[264px] shrink-0 flex-col border-r max-lg:h-[230px] max-lg:w-full max-lg:border-r-0 max-lg:border-t" style={{ backgroundColor: "var(--panel-bg)", borderColor: "var(--glass-border)" }}>
          <div className="flex shrink-0 gap-1 p-1.5">
            {(
              [
                ["library", "Library"],
                ["browser", "Browser"],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setLeftTab(tab)}
                className="h-7 flex-1 rounded-[7px] border text-[12px] font-medium"
                style={
                  leftTab === tab
                    ? { borderColor: "var(--brand)", backgroundColor: "var(--brand-soft)", color: "var(--text-main)" }
                    : { borderColor: "var(--glass-border)", color: "var(--text-muted)" }
                }
              >
                {label}
              </button>
            ))}
          </div>
          {leftTab === "library" ? (
            <>
              <div className="flex shrink-0 items-center gap-1.5 px-1.5 pb-1.5">
                <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[7px] border px-2" style={{ borderColor: "var(--glass-border)" }}>
                  <Search size={13} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                  <input
                    value={libSearch}
                    onChange={(e) => setLibSearch(e.target.value)}
                    placeholder="Search pieces"
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[12px] font-medium shadow-none outline-none"
                    style={{ color: "var(--text-main)" }}
                    aria-label="Search pieces"
                  />
                </label>
                <GlassDropdown
                  value={room}
                  options={rooms.map((r) => ({ value: r, label: r }))}
                  onChange={setRoom}
                  ariaLabel="Room"
                  menuMinWidth={150}
                  menuAlign="right"
                  triggerClassName="cs-own-fill h-7 max-w-[108px] shrink-0 justify-between rounded-[7px] border px-2 text-[11.5px] font-medium"
                  triggerStyle={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                />
              </div>
              <div className="hide-native-scrollbar min-h-0 flex-1 overflow-y-auto pb-2">
                {groups.length ? (
                  groups.map(([partType, list]) => {
                    const color = list[0]?.color ?? "#CBD5E1";
                    const open = !collapsed[partType];
                    return (
                      <div key={partType}>
                        <button
                          type="button"
                          onClick={() => setCollapsed((prev) => ({ ...prev, [partType]: open }))}
                          className="flex h-7 w-full items-center gap-1.5 px-2 text-left text-[11.5px] font-medium hover:bg-[var(--panel-muted)]"
                          style={{ color: "var(--text-main)" }}
                          aria-expanded={open}
                        >
                          <ChevronDown size={13} style={{ transform: open ? undefined : "rotate(-90deg)", color: "var(--text-muted)" }} />
                          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />
                          <span className="min-w-0 flex-1 truncate">{partType}</span>
                          <span style={{ color: "var(--text-muted)" }}>{list.reduce((sum, u) => sum + u.quantity, 0)}</span>
                        </button>
                        {open
                          ? list.map((u) => {
                              const used = usedCount.get(u.id) ?? 0;
                              const placeable = u.kind !== "other" && used < u.quantity;
                              return (
                                <div
                                  key={u.id}
                                  onPointerDown={(e) => {
                                    if (!placeable || (e.pointerType === "mouse" && e.button !== 0)) return;
                                    if (e.target instanceof Element && e.target.closest("button")) return;
                                    // (No text picked up, no browser drag — ours.)
                                    if (e.pointerType === "mouse") e.preventDefault();
                                    const held = { unitId: u.id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false };
                                    setDragTurn(0);
                                    libDragRef.current = held;
                                    setLibDrag(held);
                                    const move = (event: PointerEvent) => libHandlersRef.current?.move(event);
                                    const up = (event: PointerEvent) => {
                                      if (event.pointerId !== held.pointerId) return;
                                      window.removeEventListener("pointermove", move);
                                      window.removeEventListener("pointerup", up);
                                      window.removeEventListener("pointercancel", up);
                                      libHandlersRef.current?.up(event);
                                    };
                                    window.addEventListener("pointermove", move);
                                    window.addEventListener("pointerup", up);
                                    window.addEventListener("pointercancel", up);
                                  }}
                                  className={`group/piece flex select-none items-center gap-2 py-1 pl-[30px] pr-1.5 hover:bg-[var(--panel-muted)] ${placeable ? "cursor-grab active:cursor-grabbing" : ""}`}
                                  style={{ opacity: placeable || u.kind === "other" ? (libDrag?.started && libDrag.unitId === u.id ? 0.55 : 1) : 0.45, touchAction: "pan-y" }}
                                  title={u.kind === "other" ? "Can't be placed in the drawing" : `${used} of ${u.quantity} in the drawing`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-[12px] font-medium" style={{ color: "var(--text-main)" }}>{u.name || u.partType}</p>
                                    <p className="truncate text-[10.5px] font-medium" style={{ color: "var(--text-muted)" }}>{unitText(u)}</p>
                                  </div>
                                  <span className="shrink-0 text-[10.5px] font-medium tabular-nums" style={{ color: "var(--text-muted)" }}>
                                    {used}/{u.quantity}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={!placeable}
                                    onClick={() => {
                                      const { target, level } = plusTarget(u);
                                      commitUnit(u, target, level);
                                    }}
                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] opacity-0 hover:bg-[var(--panel-bg)] focus-visible:opacity-100 group-hover/piece:opacity-100 disabled:hidden max-lg:opacity-100"
                                    style={{ color: "var(--text-main)" }}
                                    aria-label="Add to the drawing"
                                    title={selected && u.kind === "fronts" && selected.kind === "box" ? "Add to the cabinet picked" : selected ? "Add next to what's picked" : "Add to the drawing"}
                                  >
                                    <Plus size={14} />
                                  </button>
                                </div>
                              );
                            })
                          : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="px-3 py-6 text-center text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                    {libSearch.trim() ? "No pieces match that." : "Nothing in the production cutlist yet."}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="hide-native-scrollbar min-h-0 flex-1 overflow-y-auto pb-2">
              {liveItems.length ? (
                liveItems.map((item) => {
                  const off = hiddenItems.has(item.id);
                  const color = (item.unitId ? unitMap.get(item.unitId)?.color : item.fronts[0] ? unitMap.get(item.fronts[0])?.color : undefined) ?? "#CBD5E1";
                  return (
                    <div
                      key={item.id}
                      className="flex h-7 items-center gap-1.5 px-1.5"
                      style={{ backgroundColor: selectedId === item.id ? "var(--brand-soft)" : undefined, opacity: off ? 0.5 : 1 }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setHiddenItems((prev) => {
                            const next = new Set(prev);
                            if (off) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          })
                        }
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] hover:bg-[var(--panel-muted)]"
                        style={{ color: "var(--text-muted)" }}
                        aria-label={off ? `Show ${nameOf(item)}` : `Hide ${nameOf(item)}`}
                        title={off ? "Show it" : "Hide it"}
                      >
                        {off ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      <button type="button" onClick={() => { setSelectedId(item.id); setPropsFolded(false); }} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />
                        <span className="min-w-0 flex-1 truncate">{nameOf(item)}</span>
                        <span className="shrink-0 text-[10.5px]" style={{ color: "var(--text-muted)" }}>{item.level === "wall" ? "Overhead" : "Base"}</span>
                      </button>
                    </div>
                  );
                })
              ) : (
                <p className="px-3 py-6 text-center text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                  Nothing in the drawing yet.
                </p>
              )}
            </div>
          )}
        </aside>

        {/* The kitchen in 3D, and the status bar under it. */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden" style={{ backgroundColor: "var(--panel-bg)" }}>
          <div
            ref={(el) => {
              hostRef.current = el;
              attachTo(el);
              if (el) setHostEl((prev) => (prev === el ? prev : el));
            }}
            className="absolute inset-0"
            style={{
              touchAction: "none",
              cursor: navTool
                ? cursor
                : tool === "measure"
                  ? "crosshair"
                  : tool === "extrude"
                    ? extrudeHover
                      ? "pointer"
                      : cursor
                    : rotating
                      ? "grabbing"
                      : rotateTool && selected
                        ? "crosshair"
                        : moveTool && selected
                          ? "move"
                          : hoverPart
                            ? "pointer"
                            : cursor,
            }}
            {...handlers}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => {
              setHoverPart(null);
              setMeasureHover(null);
              setFaceHover(null);
              setExtrudeHover(null);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              // (A right-click — not the end of a right-drag that turned the view.)
              const down = rightDownRef.current;
              rightDownRef.current = null;
              if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
              // (Measuring: the measurement finished as it is — then cleared.)
              if (tool === "measure") {
                setFaceMeasure(null);
                setMeasure((prev) => (!prev || prev.done || prev.points.length < 2 ? null : { ...prev, done: true }));
                return;
              }
              const id = itemAt(event.clientX, event.clientY);
              const box = hostRef.current?.getBoundingClientRect();
              if (!id || !box) {
                setMenu(null);
                return;
              }
              setSelectedId(id);
              setMenu({ id, x: Math.min(event.clientX - box.left, size.width - 300), y: Math.min(event.clientY - box.top, size.height - 320) });
            }}
          >
            <svg width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} className="absolute inset-0 select-none" style={{ display: "block" }}>
              <g transform={transform}>
                {drawn.filter((face) => face.room).map((face) => (
                  <polygon key={face.key} points={face.points} fill={face.fill} fillOpacity={face.fillOpacity} stroke="none" />
                ))}
                {gridLines.map((line) => (
                  <line key={line.key} x1={line.a[0]} y1={line.a[1]} x2={line.b[0]} y2={line.b[1]} stroke="var(--text-muted)" strokeOpacity={line.major ? 0.22 : 0.09} strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
                ))}
                {drawn.filter((face) => !face.room).map((face) => (
                  <polygon
                    key={face.key}
                    points={face.points}
                    fill={face.fill}
                    fillOpacity={face.fillOpacity}
                    stroke={face.stroke}
                    strokeOpacity={face.strokeOpacity}
                    strokeDasharray={face.dash}
                    strokeWidth={0.7}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {/* Extrude: the face under the pointer; the one picked, where it's got to, and its arrow. */}
                {hoveredFace ? <polygon points={hoveredFace.screen.map((q) => q.join(",")).join(" ")} fill="#F97316" fillOpacity={0.25} stroke="#F97316" strokeWidth={1.2} vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
                {extrudeShape ? (
                  <g>
                    <polygon points={extrudeShape.points.map((q) => q.join(",")).join(" ")} fill="#F97316" fillOpacity={0.4} stroke="#EA580C" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                    {(() => {
                      const { start, dir } = extrudeShape;
                      const end = add(start, mul(dir, 58 / zoom.z));
                      const head = 10 / zoom.z;
                      const back = sub(end, mul(dir, head));
                      const side = mul(perp(dir), head * 0.55);
                      return (
                        <g
                          data-kitchen-gizmo="true"
                          style={{ cursor: "grab" }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            if (extrude) startExtrudeDrag(e, extrude.face, extrude.dist);
                          }}
                        >
                          <title>Drag to extrude</title>
                          <line x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} stroke="transparent" strokeWidth={16} vectorEffect="non-scaling-stroke" />
                          <line x1={start[0]} y1={start[1]} x2={back[0]} y2={back[1]} stroke="#EA580C" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                          <polygon points={[end, add(back, side), sub(back, side)].map((q) => q.join(",")).join(" ")} fill="#EA580C" />
                        </g>
                      );
                    })()}
                  </g>
                ) : null}
                {/* The size of what's picked. */}
                {dimLines.map((line) => {
                  const mid: Vec = [(line.a[0] + line.b[0]) / 2, (line.a[1] + line.b[1]) / 2];
                  return (
                    <g key={`${line.a.join()}_${line.b.join()}`} pointerEvents="none">
                      <line x1={line.a[0]} y1={line.a[1]} x2={line.b[0]} y2={line.b[1]} stroke="#2563EB" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
                      <text x={mid[0]} y={mid[1]} fontSize={11 / zoom.z} fontWeight={500} textAnchor="middle" dominantBaseline="middle" fill="#1D4ED8" stroke="var(--panel-bg)" strokeWidth={3 / zoom.z} paintOrder="stroke">
                        {line.label}
                      </text>
                    </g>
                  );
                })}
                {/* Face to face: the faces; the line square between them; the second's plane carried across to meet it. */}
                {tool === "measure"
                  ? (() => {
                      const shape = (face: MeasureFace) => face.points.map((q) => drawProjector.project(q as Point3).join(",")).join(" ");
                      const hover = faceHover && faceHover.key !== faceMeasure?.a.key && faceHover.key !== faceMeasure?.b?.key ? faceHover : null;
                      const from = faceResult ? (drawProjector.project(faceResult.from) as Vec) : null;
                      const to = faceResult ? (drawProjector.project(faceResult.to) as Vec) : null;
                      const other = faceResult ? (drawProjector.project(faceResult.carriedFrom) as Vec) : null;
                      const across = from && to ? mul(perp(unit(sub(to, from))), 5 / zoom.z) : null;
                      return (
                        <g pointerEvents="none">
                          {hover ? <polygon points={shape(hover)} fill="#16A34A" fillOpacity={0.2} stroke="#16A34A" strokeWidth={1.2} vectorEffect="non-scaling-stroke" /> : null}
                          {faceMeasure && faceMeasure.a.points.length > 2 ? <polygon points={shape(faceMeasure.a)} fill="#DC2626" fillOpacity={0.25} stroke="#DC2626" strokeWidth={1.4} vectorEffect="non-scaling-stroke" /> : null}
                          {faceMeasure?.b && faceMeasure.b.points.length > 2 ? <polygon points={shape(faceMeasure.b)} fill="#DC2626" fillOpacity={0.25} stroke="#DC2626" strokeWidth={1.4} vectorEffect="non-scaling-stroke" /> : null}
                          {other && to && len(sub(other, to)) > 0.5 ? <line x1={other[0]} y1={other[1]} x2={to[0]} y2={to[1]} stroke="#DC2626" strokeWidth={1.2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" /> : null}
                          {from && to && across ? (
                            <>
                              <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke="#DC2626" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
                              {[from, to].map((end, i) => (
                                <line key={i} x1={end[0] - across[0]} y1={end[1] - across[1]} x2={end[0] + across[0]} y2={end[1] + across[1]} stroke="#DC2626" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
                              ))}
                              <text x={(from[0] + to[0]) / 2} y={(from[1] + to[1]) / 2 - 8 / zoom.z} fontSize={12 / zoom.z} fontWeight={500} textAnchor="middle" fill="#B91C1C" stroke="var(--panel-bg)" strokeWidth={3 / zoom.z} paintOrder="stroke">
                                {faceResult ? fmtMm(faceResult.distance) : ""}
                              </text>
                            </>
                          ) : null}
                        </g>
                      );
                    })()
                  : null}
                {/* The measurement: its points, the lines between them, what they come to. */}
                {tool === "measure" ? (
                  <g pointerEvents="none">
                    {measurePoints.slice(1).map((q, i) => {
                      const a = drawProjector.project(measurePoints[i]);
                      const b = drawProjector.project(q);
                      return (
                        <g key={`m${i}`}>
                          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#DC2626" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
                          <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 8 / zoom.z} fontSize={12 / zoom.z} fontWeight={500} textAnchor="middle" fill="#B91C1C" stroke="var(--panel-bg)" strokeWidth={3 / zoom.z} paintOrder="stroke">
                            {fmtMm(measureLength(measurePoints[i], q))}
                          </text>
                        </g>
                      );
                    })}
                    {measureAngle !== null ? (
                      <text x={drawProjector.project(measurePoints[1])[0]} y={drawProjector.project(measurePoints[1])[1] + 18 / zoom.z} fontSize={12 / zoom.z} fontWeight={500} textAnchor="middle" fill="#B91C1C" stroke="var(--panel-bg)" strokeWidth={3 / zoom.z} paintOrder="stroke">
                        {`${Math.round(measureAngle * 10) / 10}°`}
                      </text>
                    ) : null}
                    {measurePoints.map((q, i) => {
                      const a = drawProjector.project(q);
                      return <circle key={`p${i}`} cx={a[0]} cy={a[1]} r={3.5 / zoom.z} fill="#FFFFFF" stroke="#DC2626" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
                    })}
                    {measureHover?.edge ? (
                      <line
                        x1={drawProjector.project(measureHover.edge[0])[0]}
                        y1={drawProjector.project(measureHover.edge[0])[1]}
                        x2={drawProjector.project(measureHover.edge[1])[0]}
                        y2={drawProjector.project(measureHover.edge[1])[1]}
                        stroke="#16A34A"
                        strokeWidth={2.2}
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                    {measureHover ? (
                      <circle cx={drawProjector.project(measureHover.p)[0]} cy={drawProjector.project(measureHover.p)[1]} r={(measureHover.snapped ? 5 : 3) / zoom.z} fill={measureHover.snapped ? "#16A34A" : "none"} fillOpacity={0.35} stroke={measureHover.snapped ? "#15803D" : "#DC2626"} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
                    ) : null}
                  </g>
                ) : null}
                {/* Each piece's pivot, blue, and the picked one's corners — a dot dragged onto another piece's snaps them
                    together; onto another of its own (or clicked), it's that piece's pivot. */}
                {allDots.map((pin) => {
                  const dragging = Boolean(pivotDrag) && sameRef(pivotDrag?.from, pin.ref);
                  const target = Boolean(pivotDrag?.moved && pivotDrag.over && sameRef(pivotDrag.over, pin.ref));
                  const r = target ? 7 : pin.pivot || pin.fallback ? (pin.picked ? 6 : 4.5) : pin.picked ? 3.5 : 2.6;
                  return (
                    <g
                      key={pin.key}
                      data-kitchen-pivot="true"
                      style={{ cursor: dragging ? "grabbing" : "grab" }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        try {
                          hostRef.current?.setPointerCapture(e.pointerId);
                        } catch {
                          // (Already let go.)
                        }
                        setMenu(null);
                        setPivotDrag({ pointerId: e.pointerId, from: pin.ref, over: pin.ref, x: e.clientX, y: e.clientY, moved: false });
                      }}
                    >
                      <title>{pin.pivot ? "Its pivot — click to let it go, or drag onto another piece's pivot to snap them together" : pin.fallback ? "It turns about this corner, with no pivot picked — click to make it its pivot" : "A corner — click for its pivot, or drag onto another piece's pivot"}</title>
                      <circle cx={pin.x} cy={pin.y} r={9 / zoom.z} fill="transparent" />
                      <circle
                        cx={pin.x}
                        cy={pin.y}
                        r={r / zoom.z}
                        fill={target ? "#16A34A" : pin.pivot || dragging ? "#2563EB" : "#FFFFFF"}
                        fillOpacity={pin.picked || pin.pivot || target || dragging ? 1 : 0.8}
                        stroke={target ? "#15803D" : pin.pivot || pin.fallback || dragging ? "#1D4ED8" : "#64748B"}
                        strokeWidth={pin.pivot || pin.fallback || target ? 1.6 : 1}
                        strokeOpacity={pin.picked || pin.pivot || target ? 1 : 0.7}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}
                {/* Move: the arrows on what's picked — X along it (red), Y in and out (green), Z up (blue) — dragged to slide
                    it that way. (Drawn where it's shown, so they go with it.) */}
                {moveTool && selected && !selected.locked && !moving && !dropPreview && !rotating
                  ? (() => {
                      const f = laid.frames.get(selected.id);
                      const sz = laid.sizes.get(selected.id);
                      if (!f || !sz) return null;
                      const projector = cabinetViewProjector(model, view, size);
                      const mid = toWorld(f, localCentre(selected, sz, unitMap));
                      const zTop = sz.z0 + sz.height + (sz.bench ? BENCH_MM : 0) + 10;
                      const o = projector.project([mid[0], mid[1], zTop]) as Vec;
                      const tip = (axis: MoveAxis) => {
                        const d = axis === "z" ? null : rot(f.a, axis === "x" ? [1, 0] : [0, 1]);
                        const e = (d ? projector.project([mid[0] + d[0] * 300, mid[1] + d[1] * 300, zTop]) : projector.project([mid[0], mid[1], zTop + 300])) as Vec;
                        const v = unit(sub(e, o));
                        return { v, end: add(o, mul(v, 62 / zoom.z)) };
                      };
                      const arrowColors: Record<MoveAxis, string> = { x: "#DC2626", y: "#16A34A", z: "#2563EB" };
                      return (
                        <g>
                          {(["x", "y", "z"] as const).map((axis) => {
                            const { v, end } = tip(axis);
                            const on = axis === moveAxis;
                            const head = 9 / zoom.z;
                            const side = mul(perp(v), head * 0.55);
                            const back = sub(end, mul(v, head));
                            const pts = [end, add(back, side), sub(back, side)].map((q) => `${q[0]},${q[1]}`).join(" ");
                            const label = add(end, mul(v, 9 / zoom.z));
                            return (
                              <g
                                key={axis}
                                data-kitchen-gizmo="true"
                                style={{ cursor: "grab" }}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  setMenu(null);
                                  startMove(e, axis);
                                }}
                              >
                                <title>{axis === "x" ? "Drag along it" : axis === "y" ? "Drag in or out" : "Drag up or down"}</title>
                                <line x1={o[0]} y1={o[1]} x2={end[0]} y2={end[1]} stroke="transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" />
                                <line x1={o[0]} y1={o[1]} x2={back[0]} y2={back[1]} stroke={arrowColors[axis]} strokeWidth={on ? 3.2 : 2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                                <polygon points={pts} fill={arrowColors[axis]} stroke={arrowColors[axis]} strokeWidth={on ? 1.5 : 1} vectorEffect="non-scaling-stroke" />
                                <text x={label[0]} y={label[1]} fill={arrowColors[axis]} fontSize={11 / zoom.z} fontWeight={700} textAnchor="middle" dominantBaseline="middle" style={{ pointerEvents: "none" }}>
                                  {axis.toUpperCase()}
                                </text>
                              </g>
                            );
                          })}
                          <circle cx={o[0]} cy={o[1]} r={3.5 / zoom.z} fill="#FFFFFF" stroke="#0F172A" strokeWidth={1.2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                        </g>
                      );
                    })()
                  : null}
                {/* The bench edge picked. */}
                {benchEdge
                  ? (() => {
                      const projector = cabinetViewProjector(model, view, size);
                      const a = projector.project([benchEdge.a[0], benchEdge.a[1], benchEdge.z]);
                      const b = projector.project([benchEdge.b[0], benchEdge.b[1], benchEdge.z]);
                      return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#F97316" strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />;
                    })()
                  : null}
                {/* (The corner being dragged, following the pointer.) */}
                {pivotDrag?.moved
                  ? (() => {
                      const from = allDots.find((d) => sameRef(d.ref, pivotDrag.from));
                      const over = pivotDrag.over ? allDots.find((d) => sameRef(d.ref, pivotDrag.over)) : null;
                      if (!from) return null;
                      if (over && over !== from) {
                        return <line x1={from.x} y1={from.y} x2={over.x} y2={over.y} stroke="#16A34A" strokeWidth={1.6} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />;
                      }
                      // (Nothing under it yet: the line to the pointer, so the drag can be seen.)
                      return pivotDrag.pointer ? (
                        <line x1={from.x} y1={from.y} x2={pivotDrag.pointer[0]} y2={pivotDrag.pointer[1]} stroke="#64748B" strokeWidth={1.2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                      ) : null;
                    })()
                  : null}
              </g>
            </svg>
          </div>
          {/* The view cube. */}
          <div className="absolute right-3 top-3 z-10">
            <ViewCube
              view={view}
              onPick={(next) => {
                goToView(next);
                fitView();
              }}
            />
          </div>
          {/* What's measured, in words. */}
          {tool === "measure" && measurePoints.length >= 2 ? (
            <div className="absolute left-3 top-3 z-20 min-w-[170px] rounded-[10px] border px-3 py-2 text-[12px] font-medium shadow-lg" style={{ ...floatingPanelStyle, color: "var(--text-main)" }}>
              <div className="flex items-center justify-between gap-3">
                <span style={{ color: "var(--text-muted)" }}>{measureAngle !== null ? "Angle" : "Distance"}</span>
                <span className="tabular-nums">{measureAngle !== null ? `${Math.round(measureAngle * 10) / 10}°` : fmtMm(measureLength(measurePoints[0], measurePoints[1]))}</span>
              </div>
              {measureAngle === null ? (
                <div className="mt-1 flex gap-2 text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                  {(["X", "Y", "Z"] as const).map((axis, i) => (
                    <span key={axis}>
                      {axis} {Math.round(Math.abs(measurePoints[0][i] - measurePoints[1][i]))}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {/* Face to face, in words. */}
          {tool === "measure" && faceResult ? (
            <div className="absolute left-3 top-3 z-20 min-w-[190px] rounded-[10px] border px-3 py-2 text-[12px] font-medium shadow-lg" style={{ ...floatingPanelStyle, color: "var(--text-main)" }}>
              <div className="flex items-center justify-between gap-3">
                <span style={{ color: "var(--text-muted)" }}>{faceMeasure?.a.points.length === 1 || (faceSecond?.points.length ?? 3) === 1 ? "Point to face" : "Face to face"}</span>
                <span className="tabular-nums">{fmtMm(faceResult.distance)}</span>
              </div>
              {!faceResult.parallel ? (
                <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Not parallel: {Math.round(faceResult.angle * 10) / 10}° apart. Measured square to the second face, from the first&apos;s nearest corner.
                </p>
              ) : null}
            </div>
          ) : null}
          {/* Extrude: how far — dragged or typed; Enter or the tick keeps it, Esc or the cross puts it back. */}
          {extrude ? (
            <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[10px] border px-2.5 py-1.5 shadow-lg" style={floatingPanelStyle}>
              <span className="text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                Extrude {extrude.face.kind === "side" ? "side" : extrude.face.kind === "top" ? "top" : "underneath"}
              </span>
              <MeasureBox
                idle={!extrude.dist && extrude.text === "0"}
                type="text"
                inputMode="decimal"
                value={extrude.text}
                onChange={(e) => {
                  const text = e.target.value.replace(/[^0-9.-]/g, "");
                  const dist = Number.parseFloat(text);
                  setExtrude({ ...extrude, text, dist: Number.isFinite(dist) ? dist : 0 });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitExtrude();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setExtrude(null);
                  }
                }}
                className="h-7 w-[76px] rounded-[7px] border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2 text-right text-[12px] font-medium text-[var(--text-main)]"
                aria-label="Distance (mm)"
              />
              <span className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                mm
              </span>
              <button type="button" onClick={commitExtrude} className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-white" style={{ backgroundColor: "#16A34A" }} aria-label="Keep it" title="Keep it (Enter)">
                <Check size={14} />
              </button>
              <button type="button" onClick={() => setExtrude(null)} className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] hover:bg-[var(--panel-muted)]" style={{ color: "var(--text-main)" }} aria-label="Cancel" title="Cancel (Esc)">
                <X size={14} />
              </button>
            </div>
          ) : null}
          {/* An overhead cabinet made from fronts just dropped: how deep — Enter (or the tick) sets it, Esc keeps it as is. */}
          {depthAsk && liveItems.some((i) => i.id === depthAsk.id) ? (
            <div
              className="absolute left-1/2 top-12 z-20 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 shadow-lg"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--glass-bg-strong)", backdropFilter: "blur(14px) saturate(200%)", WebkitBackdropFilter: "blur(14px) saturate(200%)" }}
            >
              <span className="text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                Overhead cabinet depth
              </span>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={depthAsk.text}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setDepthAsk({ ...depthAsk, text: e.target.value.replace(/[^0-9.]/g, "") })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setDepth(depthAsk.id, Number.parseFloat(depthAsk.text));
                    setDepthAsk(null);
                  }
                  if (e.key === "Escape") setDepthAsk(null);
                }}
                className="h-7 w-[72px] rounded-full border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2.5 text-right text-[12px] font-medium text-[var(--text-main)]"
                aria-label="Cabinet depth (mm)"
              />
              <span className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                mm
              </span>
              <button
                type="button"
                onClick={() => {
                  setDepth(depthAsk.id, Number.parseFloat(depthAsk.text));
                  setDepthAsk(null);
                }}
                className="glass-shine inline-flex h-7 w-7 items-center justify-center rounded-full border text-white"
                style={glassShineStyle("#16A34A")}
                aria-label="Set it"
                title="Set it (Enter)"
              >
                ✓
              </button>
              <button type="button" onClick={() => setDepthAsk(null)} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--panel-muted)]" style={{ color: "var(--text-main)" }} aria-label="Keep it as is">
                <X size={13} />
              </button>
            </div>
          ) : null}
          {/* A bench edge picked: its overhang — from the face of what's under it that way — typed, Enter (or the tick) to set
              it; Default — back to the Benchtop settings. */}
          {benchEdge ? (
            <div
              className="absolute left-1/2 top-12 z-20 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 shadow-lg"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--glass-bg-strong)", backdropFilter: "blur(14px) saturate(200%)", WebkitBackdropFilter: "blur(14px) saturate(200%)" }}
            >
              <span className="text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                Bench edge overhang
              </span>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={benchEdgeText}
                placeholder="mm"
                onFocus={(e) => e.target.select()}
                onChange={(e) => setBenchEdgeText(e.target.value.replace(/[^0-9.-]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const mm = Number.parseFloat(benchEdgeText);
                    if (Number.isFinite(mm)) setBenchEdgeOverhang(mm);
                  }
                  if (e.key === "Escape") setBenchEdge(null);
                }}
                className="h-7 w-[72px] rounded-full border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2.5 text-right text-[12px] font-medium text-[var(--text-main)]"
                aria-label="Overhang (mm)"
              />
              <span className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                mm
              </span>
              <button
                type="button"
                onClick={() => {
                  const mm = Number.parseFloat(benchEdgeText);
                  if (Number.isFinite(mm)) setBenchEdgeOverhang(mm);
                }}
                className="glass-shine inline-flex h-7 w-7 items-center justify-center rounded-full border text-white"
                style={glassShineStyle("#16A34A")}
                aria-label="Set it"
                title="Set it (Enter)"
              >
                ✓
              </button>
              <button type="button" onClick={() => setBenchEdgeOverhang(undefined)} className="rounded-full px-2 py-0.5 text-[11.5px] font-medium hover:bg-[var(--panel-muted)]" style={{ color: "var(--brand)" }} title="Back to the Benchtop settings">
                Default
              </button>
              <button type="button" onClick={() => setBenchEdge(null)} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--panel-muted)]" style={{ color: "var(--text-main)" }} aria-label="Close">
                <X size={13} />
              </button>
            </div>
          ) : null}
          {/* Move: the axis, how far (dragged, or typed) — Enter or the tick locks it in, Esc or the cross puts it back. */}
          {moveTool && selected && !selected.locked ? (
            <div
              className="absolute bottom-12 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-2 py-1 shadow-lg"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--glass-bg-strong)", backdropFilter: "blur(14px) saturate(200%)", WebkitBackdropFilter: "blur(14px) saturate(200%)" }}
            >
              {(["x", "y", "z"] as const).map((axis) => (
                <button
                  key={axis}
                  type="button"
                  onClick={() => {
                    if (axis === moveAxis) return;
                    // (What's been moved along the last one, kept first.)
                    lockMove();
                    setMoveAxis(axis);
                  }}
                  className={`inline-flex h-7 w-8 items-center justify-center rounded-full text-[12px] font-semibold ${axis === moveAxis ? "glass-shine border" : ""}`}
                  style={axis === moveAxis ? { ...glassShineStyle("#2563EB"), color: "#FFFFFF" } : { color: "var(--text-main)" }}
                  title={axis === "x" ? "Along it" : axis === "y" ? "In and out" : "Up and down"}
                >
                  {axis.toUpperCase()}
                </button>
              ))}
              <MeasureBox
                idle={!draft}
                type="text"
                inputMode="decimal"
                value={draft?.text ?? "0"}
                onChange={(e) => {
                  const text = e.target.value.replace(/[^0-9.-]/g, "");
                  const delta = Number.parseFloat(text);
                  setMoveDraft({ id: selected.id, delta: Number.isFinite(delta) ? delta : 0, text });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") lockMove();
                  if (e.key === "Escape" && draft) {
                    e.stopPropagation();
                    setMoveDraft(null);
                  }
                }}
                className="h-7 w-[84px] rounded-full border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2.5 text-right text-[12px] font-medium text-[var(--text-main)]"
                aria-label="How far (mm)"
              />
              <span className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                mm
              </span>
              <button type="button" onClick={lockMove} className="glass-shine inline-flex h-7 w-7 items-center justify-center rounded-full border text-white" style={glassShineStyle("#16A34A")} aria-label="Lock it in" title="Lock it in (Enter)">
                ✓
              </button>
              <button type="button" onClick={() => setMoveDraft(null)} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--panel-muted)]" style={{ color: "var(--text-main)" }} aria-label="Put it back" title="Put it back (Esc)">
                <X size={13} />
              </button>
            </div>
          ) : null}
          {/* Rotate, on a piece on its own: how far to turn it — Enter or the tick keeps it, Esc or the cross puts it back. */}
          {rotateTool && selected && !selected.locked && selected.kind !== "custom" && selected.at.kind === "free" ? (
            <div
              className="absolute bottom-12 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border py-1 pl-3.5 pr-2 shadow-lg"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--glass-bg-strong)", backdropFilter: "blur(14px) saturate(200%)", WebkitBackdropFilter: "blur(14px) saturate(200%)" }}
            >
              <span className="whitespace-nowrap text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                Turn by
              </span>
              <MeasureBox
                idle={!turnTyped}
                type="text"
                inputMode="decimal"
                value={turnTyped?.text ?? "0"}
                onChange={(e) => {
                  const text = e.target.value.replace(/[^0-9.-]/g, "");
                  const deg = Number.parseFloat(text);
                  setRotateTyped({ id: selected.id, deg: Number.isFinite(deg) ? deg : 0, text });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") lockTurn();
                  if (e.key === "Escape" && turnTyped) {
                    e.stopPropagation();
                    setRotateTyped(null);
                  }
                }}
                className="h-7 w-[72px] rounded-full border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2.5 text-right text-[12px] font-medium text-[var(--text-main)]"
                aria-label="Turn by (degrees)"
                title="+ anticlockwise, − clockwise, seen from above"
              />
              <span className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                °
              </span>
              <button type="button" onClick={lockTurn} className="glass-shine inline-flex h-7 w-7 items-center justify-center rounded-full border text-white" style={glassShineStyle("#16A34A")} aria-label="Keep it" title="Keep it (Enter)">
                ✓
              </button>
              <button type="button" onClick={() => setRotateTyped(null)} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--panel-muted)]" style={{ color: "var(--text-main)" }} aria-label="Put it back" title="Put it back (Esc)">
                <X size={13} />
              </button>
            </div>
          ) : null}
          {/* Where what's dragged will go. */}
          {hint ? (
            <div className="glass-shine pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border px-3 py-1 text-[12px] font-semibold text-white" style={glassShineStyle("var(--brand)")}>
              {hint}
            </div>
          ) : null}
          {menu && menuItem ? (
            <div
              data-kitchen-menu="true"
              className="absolute z-20 w-[290px] rounded-[14px] border p-2.5 shadow-lg"
              style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y), borderColor: "var(--glass-border)", backgroundColor: "var(--glass-bg-strong)", backdropFilter: "blur(16px) saturate(200%)", WebkitBackdropFilter: "blur(16px) saturate(200%)" }}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <div className="mb-2 flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" style={{ color: "var(--text-main)" }}>
                  {nameOf(menuItem)}
                </p>
                <button type="button" onClick={() => setMenu(null)} className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-[var(--panel-muted)]" aria-label="Close" style={{ color: "var(--text-main)" }}>
                  <X size={13} />
                </button>
              </div>
              {menuItem.kind === "panel" ? <div className="mb-2.5">{panelKindControl(menuItem)}</div> : null}
              {menuItem.kind === "gap" ? <div className="mb-2.5">{gapSettings(menuItem)}</div> : null}
              {cornerControls(menuItem) ?? (
                <p className="text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                  Run it off something to make a corner.
                </p>
              )}
              {gapControls(menuItem) ? (
                <div className="mt-2.5 border-t pt-2" style={{ borderColor: "var(--glass-border)" }}>
                  {gapControls(menuItem)}
                </div>
              ) : null}
              <div className="mt-2.5 flex gap-1.5 border-t pt-2" style={{ borderColor: "var(--glass-border)" }}>
                {menuItem.at.kind === "attach" ? (
                  <button
                    type="button"
                    onClick={() => {
                      update(menuItem.id, { at: freeAt(menuItem.id) });
                      setMenu(null);
                    }}
                    className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-full text-[11.5px] font-medium hover:bg-[var(--panel-muted)]"
                    style={{ color: "var(--text-main)" }}
                  >
                    <Link2Off size={12} />
                    Unhook
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    remove(menuItem.id);
                    setMenu(null);
                  }}
                  className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-full text-[11.5px] font-medium hover:bg-[var(--panel-muted)]"
                  style={{ color: "var(--danger)" }}
                >
                  <Trash2 size={12} />
                  Remove
                </button>
              </div>
            </div>
          ) : null}
          {!liveItems.length && !dropPreview ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-6">
              <p className="rounded-[8px] px-3 py-1.5 text-center text-[12px] font-medium" style={{ backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}>
                Drag a front, a cabinet or a panel from the library onto the floor to start.
              </p>
            </div>
          ) : null}
          {/* What's picked: floating over the drawing, so the drawing doesn't move. */}
          {selected && selectedSize && propsFolded && tool !== "extrude" && tool !== "measure" ? (
            <button type="button" onClick={() => setPropsFolded(false)} className="absolute right-3 top-[104px] z-20 inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12px] font-medium shadow-lg" style={{ ...floatingPanelStyle, color: "var(--text-main)" }}>
              <SlidersHorizontal size={13} />
              Properties
            </button>
          ) : null}
          {propsShown && selected && selectedSize ? (
            <div className={floatingPanelClass} style={floatingPanelStyle} onPointerDown={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <p className="flex-1 text-[14px] font-semibold first-letter:uppercase" style={{ color: "var(--text-main)" }}>
                  {selectedTitle}
                </p>
                <button type="button" onClick={() => setPropsFolded(true)} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--panel-muted)]" aria-label="Close">
                  <X size={14} />
                </button>
              </div>
              {pieceOptions(selected, selectedSize)}
              {selected.kind === "box" && !selected.unitId ? (
                <label className="mt-3 flex items-center gap-2 text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                  <span className="flex-1">
                    Cabinet depth
                    <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Its back stays where it is.
                    </span>
                  </span>
                  <input
                    key={`${selected.id}_${selectedSize.depth}`}
                    type="text"
                    inputMode="decimal"
                    defaultValue={String(Math.round(selectedSize.depth))}
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => {
                      const mm = Number.parseFloat(e.target.value);
                      if (Number.isFinite(mm) && Math.abs(mm - selectedSize.depth) > 0.5) setDepth(selected.id, mm);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="h-7 w-[72px] rounded-full border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2.5 text-right text-[12px] font-medium text-[var(--text-main)]"
                    aria-label="Cabinet depth (mm)"
                  />
                  <span>mm</span>
                </label>
              ) : null}
              <div className="mt-3 grid grid-cols-3 gap-2">
                {(selected.kind === "panel"
                  ? [
                      ["Height", selectedSize.height],
                      ["Width", selectedSize.depth],
                      ["Thick", selectedSize.width],
                    ]
                  : [
                      ["Width", selectedSize.width],
                      ["Height", selectedSize.height],
                      ["Depth", selectedSize.depth],
                    ]
                ).map(([label, value]) => (
                  <div key={label} className="rounded-[12px] border px-2.5 py-1.5" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
                    <p className="text-[10.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                      {label}
                    </p>
                    <p className="text-[14px] font-semibold" style={{ color: "var(--text-main)" }}>
                      {Math.round(Number(value))}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-[12px] border px-3 py-2 text-[11.5px] font-medium leading-[1.5]" style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--brand) 6%, var(--panel-bg))", color: "var(--text-main)" }}>
                <p className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
                  How it&apos;s worked out
                </p>
                {selectedSize.working.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {selected.kind === "box" && isExisting(selected) ? (
                  <p className="mt-1" style={{ color: "var(--text-muted)" }}>
                    Gaps from General › Gap allowances. An existing cabinet — kept from the old kitchen, just new fronts. Put fronts on a Cabinetry cabinet for a new one.
                  </p>
                ) : null}
              </div>
              {/* A Cabinetry one's pieces — any left off stay off (for every one of it) till they're ticked back on. */}
              {cabinetPieces.length && selectedUnit ? (
                <div className="mt-3 overflow-hidden rounded-[12px] border" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
                  <button
                    type="button"
                    onClick={() => setPiecesOpen((open) => !open)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] font-medium"
                    style={{ color: "var(--text-main)" }}
                    aria-expanded={piecesOpen}
                  >
                    <span className="flex-1">Cabinet pieces</span>
                    <span className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                      {cabinetPieces.filter((p) => !piecesOff.has(p.key)).length} of {cabinetPieces.length} on
                    </span>
                    <ChevronDown size={14} style={{ transform: piecesOpen ? "rotate(180deg)" : undefined, transition: "transform 160ms ease" }} />
                  </button>
                  {piecesOpen ? (
                    <div className="border-t px-1.5 py-1" style={{ borderColor: "var(--glass-border)" }}>
                      {cabinetPieces.map((p) => (
                        <label key={p.key} className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 text-[12.5px] font-medium hover:bg-[var(--panel-muted)]" style={{ color: "var(--text-main)" }}>
                          <input
                            type="checkbox"
                            checked={!piecesOff.has(p.key)}
                            onChange={(e) => setPieceOn(selectedUnit.id, p.key, e.target.checked)}
                            className="h-4 w-4 accent-[var(--brand)]"
                          />
                          <span className={piecesOff.has(p.key) ? "line-through opacity-60" : undefined}>{p.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {selected.kind === "box" && selected.fronts.length > 1 ? (
                <div className="mt-3">
                  <Segmented
                    value={colsOf(selected).length === 1 ? "stack" : "side"}
                    onChange={(layout) => setItems((prev) => prev.map((c) => (c.id === selected.id ? withCols(c, layout === "stack" ? [c.fronts.slice()] : c.fronts.map((id) => [id])) : c)))}
                    options={[
                      { value: "side", label: "Side by side" },
                      { value: "stack", label: "Stacked" },
                    ]}
                    pill
                    fill
                    tone="brand"
                    flip
                  />
                </div>
              ) : null}
              {selected.kind === "box" ? (
                <>
                  <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
                    Fronts
                  </p>
                  <div className="space-y-1.5">
                    {selected.fronts.map((id, index) => {
                      const u = unitMap.get(id);
                      if (!u) return null;
                      return (
                        <div key={`${id}_${index}`} className="flex items-center gap-2 rounded-[10px] border px-2.5 py-1.5" style={{ borderColor: mixCabinetColor(u.color, "#0F172A", 0.12), backgroundColor: mixCabinetColor(u.color, "#FFFFFF", 0.78) }}>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] font-medium text-slate-900">{u.name || u.partType}</p>
                            <p className="truncate text-[10.5px] text-slate-600">{unitText(u)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              // (Taken out of its column — the index-th of them all.)
                              let n = -1;
                              const cols = colsOf(selected).map((col) => col.filter(() => (n += 1) !== index));
                              setItems((prev) => prev.map((c) => (c.id === selected.id ? withCols(c, cols) : c)));
                            }}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-600 hover:bg-black/10"
                            aria-label="Take it out"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      );
                    })}
                    {!selected.fronts.length ? (
                      <p className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                        No fronts — drag one onto the middle of it.
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
              {selected.kind === "panel" ? <div className="mt-3">{panelKindControl(selected)}</div> : null}
              {selected.kind === "gap" ? <div className="mt-3">{gapSettings(selected)}</div> : null}
              {gapControls(selected) ? (
                <div className="mt-3 rounded-[12px] border px-3 py-2.5" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
                  {gapControls(selected)}
                </div>
              ) : null}
              {cornerControls(selected) ? (
                <div className="mt-3 rounded-[12px] border px-3 py-2.5" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
                  <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
                    {selected.at.kind === "attach" ? "Corner" : "Turn"}
                  </p>
                  {cornerControls(selected)}
                </div>
              ) : null}
              <div className="mt-3 grid grid-cols-3 gap-2">
                {selected.at.kind === "attach" ? (
                  <button
                    type="button"
                    disabled={selected.locked}
                    onClick={() => update(selected.id, { at: freeAt(selected.id) })}
                    className="glass-shine glass-shine-neutral col-span-2 inline-flex h-9 items-center justify-center gap-1.5 rounded-full border text-[12.5px] font-medium"
                    style={{ color: "var(--text-main)" }}
                    title="Keep it where it is, on its own — not run off what it's next to"
                  >
                    <Link2Off size={14} />
                    Unhook
                  </button>
                ) : (
                  <>
                    <button type="button" disabled={selected.locked} onClick={() => turn(selected.id, -Math.PI / 2)} className="glass-shine glass-shine-neutral inline-flex h-9 items-center justify-center rounded-full border disabled:opacity-50" style={{ color: "var(--text-main)" }} aria-label="Turn left" title="Turn it (and what runs off it) a quarter left">
                      <RotateCcw size={15} />
                    </button>
                    <button type="button" disabled={selected.locked} onClick={() => turn(selected.id, Math.PI / 2)} className="glass-shine glass-shine-neutral inline-flex h-9 items-center justify-center rounded-full border disabled:opacity-50" style={{ color: "var(--text-main)" }} aria-label="Turn right" title="Turn it (and what runs off it) a quarter right">
                      <RotateCw size={15} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={selected.locked}
                  onClick={() => remove(selected.id)}
                  className="glass-shine inline-flex h-9 items-center justify-center gap-1.5 rounded-full border text-[12.5px] font-medium text-white disabled:opacity-50"
                  style={glassShineStyle("var(--danger)")}
                  aria-label="Remove"
                  title="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ) : null}
          {/* The benchtop's overhangs, and the project's gaps. */}
          {settingsOpen && !propsShown ? (
            <div className={floatingPanelClass} style={floatingPanelStyle} onPointerDown={(e) => e.stopPropagation()}>
              <div className="mb-2 flex items-center">
                <p className="flex-1 text-[13px] font-medium" style={{ color: "var(--text-main)" }}>Settings</p>
                <button type="button" onClick={() => setSettingsOpen(false)} className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] hover:bg-[var(--panel-muted)]" style={{ color: "var(--text-main)" }} aria-label="Close">
                  <X size={14} />
                </button>
              </div>
              {/* Benchtop settings: how far it runs past the fronts, and past the panels. */}
              <div className="w-full rounded-[12px] border px-3 py-2.5 text-left" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
                <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
                  Benchtop
                </p>
                <p className="mb-2 text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                  Overhangs — Fronts: past the fronts&apos; faces, the whole run (over panels too). Panels: past a panel&apos;s end, at the end of a run. Never into anything taller beside it.
                </p>
                {(
                  [
                    ["fronts", "Fronts"],
                    ["panels", "Panels (ends)"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="mb-1.5 flex items-center gap-2 text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
                    <span className="flex-1">{label}</span>
                    <input
                      key={`${key}_${benchOver[key]}`}
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={benchOver[key]}
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => {
                        const mm = Number(e.target.value);
                        if (Number.isFinite(mm) && mm >= 0 && mm !== benchOver[key]) setBenchOver((prev) => ({ ...prev, [key]: mm }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="h-7 w-[72px] rounded-full border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2.5 text-right text-[12px] font-medium text-[var(--text-main)]"
                      aria-label={`${label} overhang (mm)`}
                    />
                    <span>mm</span>
                  </label>
                ))}
              </div>
              <div className="mt-3 w-full rounded-[12px] border px-3 py-2 text-left text-[11.5px] font-medium leading-[1.6]" style={{ borderColor: "var(--glass-border)", color: "var(--text-main)" }}>
                <p className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
                  This project&apos;s gaps
                </p>
                <p>Between doors: {gaps.doorGap} (tall {gaps.tallDoorGap})</p>
                <p>Between drawers: {gaps.drawerGap}</p>
                <p>Under the bench: {gaps.benchGap}</p>
                <p>Tall and overheads, to the top: {gaps.tallTopGap}</p>
                <p>Panels: front thickness + {PANEL_PROUD_MM} proud</p>
              </div>
              {extrusions.length ? (
                <button type="button" onClick={() => setExtrusions([])} className="mt-2 h-8 rounded-[8px] border text-[12px] font-medium hover:bg-[var(--panel-muted)]" style={{ borderColor: "var(--glass-border)", color: "var(--text-main)" }}>
                  Remove {extrusions.length} extrusion{extrusions.length === 1 ? "" : "s"}
                </button>
              ) : null}
            </div>
          ) : null}
          </div>
          {/* The status bar: what the tool's asking for; the view's tools; the units. */}
          <div className="flex h-[30px] shrink-0 items-center gap-2 border-t px-2.5 text-[11.5px] font-medium" style={{ backgroundColor: "var(--panel-bg)", borderColor: "var(--glass-border)", color: "var(--text-muted)" }}>
            <span className="min-w-0 flex-1 truncate">{statusText}</span>
            <span className="flex shrink-0 items-center gap-0.5">
              <ToolButton small icon={OrbitIcon} label="Orbit: left-drag turns the view (or right-drag, any time)" active={navTool === "orbit"} onClick={() => setNavTool((now) => (now === "orbit" ? null : "orbit"))} />
              <ToolButton small icon={Hand} label="Pan: left-drag moves the view (or middle-drag, any time)" active={navTool === "pan"} onClick={() => setNavTool((now) => (now === "pan" ? null : "pan"))} />
              <ToolButton small icon={ZoomIn} label="Zoom in (or scroll)" onClick={() => zoomBy(1.25)} />
              <ToolButton small icon={ZoomOut} label="Zoom out (or scroll)" onClick={() => zoomBy(0.8)} />
              <ToolButton small icon={Maximize} label="Fit everything in view" keys="F" onClick={fitView} />
            </span>
            <span className="hidden flex-1 justify-end sm:flex">Units: mm</span>
          </div>
        </section>
      </div>
    </div>
  );
}
