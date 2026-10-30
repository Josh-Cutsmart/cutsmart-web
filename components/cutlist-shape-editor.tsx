"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check, Eraser, Magnet, Maximize2, Minus, Plus, RotateCcw, Shapes, Undo2 } from "lucide-react";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { GlassDropdown } from "@/components/glass-dropdown";
import { Segmented } from "@/components/settings-ui";
import { CUTLIST_SHAPE_BAND_COLOR, CutlistShapeThumbnail } from "@/components/cutlist-shape-thumbnail";
import { CutlistCabinet3d } from "@/components/cutlist-cabinet-3d";
import {
  CABINET_EDGE_ROLES,
  CABINET_EDGE_ROLE_COLORS,
  CABINET_EDGE_ROLE_LABELS,
  cabinetBackCorners,
  cabinetEdgeRoles,
  cabinetRoleChains,
  cabinetSettings,
  customCabinetModel,
  customCabinetParts,
  cycleCabinetEdgeRole,
  resetCabinetEdgeRoles,
  toggleCabinetThroughBack,
  type CabinetSettings,
} from "@/lib/cutlist-cabinet-shape";
import { glassShineStyle } from "@/lib/glass-shine";
import { useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import {
  CUTLIST_SHAPE_KINDS,
  bulgeFromHeight,
  clampTemplateParams,
  createCustomShape,
  createTemplateShape,
  customOutlineSelfIntersects,
  cutlistShapeForStorage,
  cutlistShapeParamLabel,
  distanceBetween,
  formatShapeMetres,
  formatShapeMm,
  isCabinetShape,
  normalizeCustomShape,
  normalizeCutlistShape,
  placeShapeLabels,
  pointsBounds,
  setCustomSegmentBulge,
  setCustomSegmentHeight,
  setCustomShapeSegmentLength,
  setShapeCornerRadius,
  shapeBandedChains,
  shapeBounds,
  shapeBulges,
  shapeChainPath,
  shapeGeometry,
  shapeOutlinePath,
  shapeRunChain,
  shapeSelfIntersects,
  shapeSlabFaces,
  signedPolygonArea,
  snapCustomPoint,
  templateDimensions,
  toggleShapeRunBanding,
  type CutlistShape,
  type CutlistShapeBase,
  type CutlistShapeKind,
  type ShapeBounds,
  type ShapeLabelRequest,
  type ShapePoint,
} from "@/lib/cutlist-shape";

// The shape editor: a Custom part type's piece drawn — a template (L corner, U shape, Notch, Angled) sized by clicking
// its numbers, or a Custom outline drawn point by point (any segment bowed into a curve) — its corners rounded and its
// edges banded, in 2D or as a 3D slab. Opened from the Production Cutlist Entry's part type pills (a new piece) and each
// Custom row's Edit shape. The geometry is all lib/cutlist-shape.ts; this only draws it and takes the clicks.
//
// What it is (given the company's other part types, `baseOptions`): a flat piece as above, or — one of its Cabinetry
// part types — a custom cabinet. Then the drawing is the cabinet's top view: its edges are set as doors, backs or ends
// (not banded), it has a height and shelves, and its parts are worked out under it (lib/cutlist-cabinet-shape.ts); 3D
// shows it as a closed cabinet in the board's thickness (components/cutlist-cabinet-3d.tsx).

// How far a template's dimension lines sit off its outline (px).
const DIM_OFFSET = 30;
// The area an empty drawing starts on (mm).
const DRAW_AREA: ShapeBounds = { minX: 0, minY: 0, maxX: 2400, maxY: 1400, width: 2400, height: 1400 };
// The shapes offered. (A plain rectangle isn't one — a row without a shape still opens on one, rectShapeFromSize.)
const EDITOR_KINDS = CUTLIST_SHAPE_KINDS.filter((option) => option.kind !== "rect");
// What's said when a change would make the outline cross itself (and it isn't made).
const CROSSING_MESSAGE = "That would cross another line";
// How far a curve's handle moves before it's a drag, not a click (px).
const DRAG_START_PX = 4;

// A finger, not a mouse: bigger targets.
const subscribeCoarsePointer = (onChange: () => void) => {
  const query = window.matchMedia("(pointer: coarse)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const readCoarsePointer = () => window.matchMedia("(pointer: coarse)").matches;
const useCoarsePointer = () => useSyncExternalStore(subscribeCoarsePointer, readCoarsePointer, () => false);

// "#RRGGBB" mixed towards another colour (0 = as it is, 1 = all the other) — the 3D view's faces are solid.
function mixHex(hex: string, other: string, amount: number): string {
  const parse = (value: string) => {
    const raw = value.trim().replace(/^#/, "");
    const full = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw;
    return /^[0-9a-f]{6}$/i.test(full) ? [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) : null;
  };
  const a = parse(hex) ?? [203, 213, 225];
  const b = parse(other) ?? [255, 255, 255];
  const mixed = a.map((channel, i) => Math.round(channel + (b[i] - channel) * Math.min(1, Math.max(0, amount))));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

const v = {
  add: (a: ShapePoint, b: ShapePoint): ShapePoint => [a[0] + b[0], a[1] + b[1]],
  sub: (a: ShapePoint, b: ShapePoint): ShapePoint => [a[0] - b[0], a[1] - b[1]],
  mul: (a: ShapePoint, k: number): ShapePoint => [a[0] * k, a[1] * k],
  dot: (a: ShapePoint, b: ShapePoint) => a[0] * b[0] + a[1] * b[1],
  unit: (a: ShapePoint): ShapePoint => {
    const l = Math.hypot(a[0], a[1]);
    return l > 1e-9 ? [a[0] / l, a[1] / l] : [0, 0];
  },
  mid: (a: ShapePoint, b: ShapePoint): ShapePoint => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
};
const pts = (list: ShapePoint[]) => list.map((p) => `${Math.round(p[0] * 100) / 100},${Math.round(p[1] * 100) / 100}`).join(" ");

// An arrowhead at `tip`, coming from `from` (px).
function arrowHead(tip: ShapePoint, from: ShapePoint, size = 6): string {
  const d = v.unit(v.sub(tip, from));
  const n: ShapePoint = [-d[1], d[0]];
  const base = v.sub(tip, v.mul(d, size));
  return pts([tip, v.add(base, v.mul(n, size * 0.42)), v.sub(base, v.mul(n, size * 0.42))]);
}

// Each shape button's little picture of it.
const KIND_GLYPHS: Record<CutlistShapeKind, string> = {
  rect: "2,4 14,4 14,12 2,12",
  L: "2,2 14,2 14,7 7,7 7,14 2,14",
  U: "2,3 14,3 14,13 10.5,13 10.5,8 5.5,8 5.5,13 2,13",
  notch: "2,3 9.5,3 9.5,7 14,7 14,13 2,13",
  angled: "2,2 14,2 14,8.5 8.5,14 2,14",
  custom: "3,13 2,5.5 8,2 14,6.5 10.5,13",
};

export type CutlistShapeEditorProps = {
  open: boolean;
  // A new number each time it's opened: it starts afresh from `shape`.
  session: number;
  // What it opens on — null: a new piece (an L corner to start).
  shape: CutlistShape | null;
  partType: string;
  room: string;
  // Its part type's colour (the drawing's wash).
  color: string;
  readOnly?: boolean;
  // How its row's grain runs ("Along the width"...), for the summary.
  grainLabel?: string;
  // Its board's thickness (mm), for the 3D view.
  thicknessMm?: number;
  // What it can be — the company's part types that aren't Custom (their category: "cabinetry", "panel"...; their
  // colour). Given, it's chosen at the top ("What is it?") and kept in shape.base: a Cabinetry one is a custom cabinet.
  // Not given: a flat piece, as it always was.
  baseOptions?: Array<{ partType: string; category: string; color?: string }>;
  // The cabinet's board thickness (mm) — what its parts are worked out at. Default: thicknessMm.
  boardThicknessMm?: number;
  // Adding a piece (Save adds a row) rather than changing one.
  isNew?: boolean;
  origin?: GlassModalOrigin;
  originElRef?: RefObject<HTMLElement | null>;
  onSave: (shape: CutlistShape) => void;
  onClose: () => void;
};

// The pop-up: grows out of what opened it (useGlassModalPopOrigin); the whole screen on a phone (globals.css).
export function CutlistShapeEditor(props: CutlistShapeEditorProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = useGlassModalPopOrigin(props.open, props.origin ?? null, panelRef, undefined, props.originElRef);
  if (!shouldRender || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[2147483646] flex items-center justify-center p-4">
      {/* (Not closed by a click outside it — a drawing half done isn't lost that way. Its X closes it.) */}
      <div className="glass-modal-backdrop absolute inset-0" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Custom shape"
        className="glass-modal-panel relative z-[2147483647] flex h-[min(800px,94vh)] w-[min(1080px,96vw)] flex-col overflow-hidden"
      >
        <ShapeEditorBody key={props.session} {...props} />
      </div>
    </div>,
    document.body,
  );
}

type ShapeState = { shape: CutlistShape; closed: boolean };
type EditorLabel = ShapeLabelRequest & { text: string; value: number; editable: boolean; title: string; live?: boolean };
// A Custom outline's segment being bowed by its handle: which, the pointer, where it went down (client px), whether it's
// moved far enough to be a drag, and its bulge so far.
type CurveDrag = { index: number; pointerId: number; start: ShapePoint; moved: boolean; bulge: number };

function ShapeEditorBody({
  shape: openedShape,
  partType,
  room,
  color,
  readOnly = false,
  grainLabel,
  thicknessMm = 18,
  baseOptions,
  boardThicknessMm,
  isNew = false,
  onSave,
  onClose,
}: CutlistShapeEditorProps) {
  const coarse = useCoarsePointer();
  const [shape, setShape] = useState<CutlistShape>(() => openedShape ?? createTemplateShape("L"));
  // What it is (shape.base), and a cabinet's height and shelves — kept apart from the drawing, so they stay as they are
  // whatever's undone or whichever shape it's switched to. (Its edges' roles and through backs are the drawing's: they
  // go with its edges, in `shape`.)
  const [base, setBase] = useState<CutlistShapeBase | null>(() => openedShape?.base ?? null);
  const [cabinet, setCabinet] = useState<CabinetSettings>(() => cabinetSettings(openedShape ?? createTemplateShape("L")));
  // The cabinet's height being typed (null: not).
  const [heightText, setHeightText] = useState<string | null>(null);
  // A cabinet's edge under the pointer, and a part hovered in its parts list.
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [hoverPart, setHoverPart] = useState<string | null>(null);
  // A Custom outline being drawn isn't closed yet (a template, or one opened, always is).
  const [closed, setClosed] = useState(true);
  // Each shape type as it was left, for going back to it.
  const [byKind, setByKind] = useState<Partial<Record<CutlistShapeKind, ShapeState>>>({});
  // A Custom outline's steps back (Undo).
  const [history, setHistory] = useState<ShapeState[]>([]);
  const [snapOn, setSnapOn] = useState(true);
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [size, setSize] = useState({ width: 0, height: 0 });
  // The drawing's scale (px per mm) — null: fitted to the view. Kept while sizes change, so the drawing grows and shrinks.
  const [scale, setScale] = useState<number | null>(null);
  // Where mm 0, 0 is on the view — null: the shape centred (a template always is; a Custom outline stays put).
  const [pan, setPan] = useState<{ ox: number; oy: number } | null>(null);
  const [pointer, setPointer] = useState<ShapePoint | null>(null);
  const [hoverRun, setHoverRun] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  // A segment being curved by dragging its handle.
  const [curveDrag, setCurveDrag] = useState<CurveDrag | null>(null);
  // A moment's word over the drawing — a change that wasn't made (it'd cross another line). `id`: each one afresh.
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
  // (A number just applied with Enter, or let go with Escape: its box's blur as it goes isn't applied again.)
  const skipBlurRef = useRef(false);
  // (A press that only put a number away isn't a point too.)
  const pressEndedEditRef = useRef(false);
  // (A curve's handle just dragged: the click that ends it isn't a click on the handle too.)
  const dragEndedRef = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // (An outline being drawn, its first point down: a resize doesn't move the view out from under it.)
  const holdViewRef = useRef(false);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const refuseCrossing = () => setNotice((prev) => ({ text: CROSSING_MESSAGE, id: (prev?.id ?? 0) + 1 }));

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = { width: 0, height: 0 };
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const next = { width: Math.round(box.width), height: Math.round(box.height) };
      if (next.width === last.width && next.height === last.height) return;
      last = next;
      setSize(next);
      // (A new size — the window, a phone turned: fitted to it afresh.)
      if (holdViewRef.current) return;
      setScale(null);
      setPan(null);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isCustom = shape.kind === "custom";
  const points = useMemo(() => shape.points ?? [], [shape.points]);
  const drawing = isCustom && !closed;
  // What's drawn: the shape — a curve being dragged, as it would be.
  const shown = useMemo(
    () => (curveDrag?.moved ? setCustomSegmentBulge(shape, curveDrag.index, curveDrag.bulge) : shape),
    [curveDrag, shape],
  );
  const geometry = useMemo(() => (drawing ? null : shapeGeometry(shown)), [drawing, shown]);
  const live = geometry && geometry.valid ? geometry : null;
  // An outline that crosses itself can't be cut: the curve being dragged (let go there, it isn't kept), or the shape
  // itself (one saved so before this was checked) — Save is off till it's put right.
  const dragCrosses = useMemo(() => Boolean(curveDrag?.moved) && shapeSelfIntersects(shown), [curveDrag, shown]);
  const crosses = useMemo(() => isCustom && closed && shapeSelfIntersects(shape), [closed, isCustom, shape]);
  const message = dragCrosses || crosses ? CROSSING_MESSAGE : (notice?.text ?? "");
  useEffect(() => {
    holdViewRef.current = drawing && points.length > 0;
  });

  // ---- A cabinet (what it is: one of the company's Cabinetry part types): the drawing is its top view. Its edges'
  // roles, where its backs meet, what it's made of and its 3D model — all from the shape as shown (a curve being
  // dragged, as it would be), at the cabinet's board thickness.
  const cabinetMode = Boolean(baseOptions?.length) && Boolean(base) && isCabinetShape(base ? { ...shape, base } : null);
  const boardMm = Math.max(0, Number(boardThicknessMm ?? thicknessMm) || 0);
  const cabShape = useMemo<CutlistShape | null>(() => {
    if (!cabinetMode || !base) return null;
    return {
      ...shown,
      base,
      cabinet: { ...(shown.cabinet ?? {}), height: cabinet.height, fixedShelves: cabinet.fixedShelves, adjustableShelves: cabinet.adjustableShelves },
    };
  }, [base, cabinet, cabinetMode, shown]);
  const cabinetLive = cabShape && live ? cabShape : null;
  const roles = useMemo(() => (cabinetLive ? cabinetEdgeRoles(cabinetLive) : []), [cabinetLive]);
  const backCorners = useMemo(() => (cabinetLive ? cabinetBackCorners(cabinetLive) : []), [cabinetLive]);
  const parts = useMemo(() => (cabinetLive ? customCabinetParts(cabinetLive, { thicknessMm: boardMm }) : []), [boardMm, cabinetLive]);
  const model = useMemo(() => (cabinetLive ? customCabinetModel(cabinetLive, { thicknessMm: boardMm }) : null), [boardMm, cabinetLive]);
  const hasRoleChanges = Boolean(shape.cabinet?.roles || shape.cabinet?.throughBacks);

  // ---- The view: mm to px.
  const pad = Math.min(76, Math.max(40, Math.min(size.width, size.height) * 0.14));
  const viewBounds: ShapeBounds = live
    ? live.bounds
    : points.length >= 2
      ? pointsBounds(points)
      : points.length === 1
        ? { ...DRAW_AREA, minX: points[0][0] - DRAW_AREA.width / 2, minY: points[0][1] - DRAW_AREA.height / 2, maxX: points[0][0] + DRAW_AREA.width / 2, maxY: points[0][1] + DRAW_AREA.height / 2 }
        : DRAW_AREA;
  const fitScale =
    size.width > 0 && size.height > 0
      ? Math.max(
          1e-4,
          Math.min(Math.max(40, size.width - 2 * pad) / Math.max(viewBounds.width, 1), Math.max(40, size.height - 2 * pad) / Math.max(viewBounds.height, 1)),
        )
      : 1;
  const s = scale ?? fitScale;
  const origin = pan ?? {
    ox: size.width / 2 - (viewBounds.minX + viewBounds.width / 2) * s,
    oy: size.height / 2 - (viewBounds.minY + viewBounds.height / 2) * s,
  };
  const toScreen = (p: ShapePoint): ShapePoint => [origin.ox + p[0] * s, origin.oy + p[1] * s];
  const toMm = (x: number, y: number): ShapePoint => [(x - origin.ox) / s, (y - origin.oy) / s];

  // ---- Changes.
  // A change to the shape: the scale kept (so it visibly grows or shrinks), unless it no longer fits — then fitted again.
  // A template's re-centred; a Custom outline stays where it is (and the change can be undone).
  const commitShape = (next: CutlistShape) => {
    const keep = scale ?? fitScale;
    const b = shapeBounds(next);
    // (Overflowing: no longer room round it for its numbers.)
    const room = pad * 0.7;
    const tooBig = b.width * keep + 2 * room > size.width || b.height * keep + 2 * room > size.height;
    if (isCustom) {
      setHistory((prev) => [...prev.slice(-99), { shape, closed }]);
      const at = pan ?? origin;
      const offView =
        at.ox + b.minX * keep < room || at.oy + b.minY * keep < room || at.ox + b.maxX * keep > size.width - room || at.oy + b.maxY * keep > size.height - room;
      if (tooBig || offView) {
        setScale(null);
        setPan(null);
      } else {
        setScale(keep);
        setPan(at);
      }
    } else {
      setScale(tooBig ? null : keep);
    }
    setShape(next);
  };

  const switchKind = (kind: CutlistShapeKind) => {
    if (readOnly || kind === shape.kind) return;
    const kept = byKind[kind];
    setByKind((prev) => ({ ...prev, [shape.kind]: { shape, closed } }));
    setShape(kept?.shape ?? (kind === "custom" ? createCustomShape() : createTemplateShape(kind)));
    setClosed(kept?.closed ?? kind !== "custom");
    setHistory([]);
    setScale(null);
    setPan(null);
    setPointer(null);
    setHoverRun(null);
    setHoverEdge(null);
    setEditing(null);
    setCurveDrag(null);
    setNotice(null);
  };

  const pushHistory = () => setHistory((prev) => [...prev.slice(-99), { shape, closed }]);
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((prev) => prev.slice(0, -1));
    setShape(last.shape);
    setClosed(last.closed);
    setEditing(null);
    setHoverRun(null);
  };
  const clearDrawing = () => {
    if (!points.length) return;
    pushHistory();
    setShape(createCustomShape());
    setClosed(false);
    setScale(null);
    setPan(null);
    setEditing(null);
  };
  const canClose = drawing && points.length >= 3 && Math.abs(signedPolygonArea(points)) > 1;
  const closeOutline = () => {
    if (!canClose) return;
    // (Its last line back to the first point mustn't cross another.)
    if (customOutlineSelfIntersects(points, shapeBulges(shape), true)) {
      refuseCrossing();
      return;
    }
    pushHistory();
    setClosed(true);
    setPointer(null);
    // (Where it is now — closing it doesn't move it.)
    setScale(s);
    setPan(origin);
  };
  const placePoint = (raw: ShapePoint) => {
    const snapped = snapCustomPoint(points, raw, { snap: snapOn, mmPerPx: 1 / s });
    if (snapped.closes) {
      closeOutline();
      return;
    }
    const last = points[points.length - 1];
    if (last && distanceBetween(last, snapped.point) < 0.5) return;
    const nextPoints = [...points, snapped.point];
    // (Its line from the last point mustn't cross — or touch — one already drawn.)
    if (customOutlineSelfIntersects(nextPoints, shapeBulges(shape), false)) {
      refuseCrossing();
      return;
    }
    pushHistory();
    // (The view held still from the first point on — the drawing doesn't move under the pointer.)
    if (!points.length) {
      setScale(s);
      setPan(origin);
    }
    // (The new line starts straight — any curve kept for a segment from the last point on is let go.)
    let next: CutlistShape = { ...shape, points: nextPoints };
    for (const key of Object.keys(shapeBulges(next)).map(Number)) {
      if (key >= points.length - 1) next = setCustomSegmentBulge(next, key, 0);
    }
    setShape(next);
  };

  // ---- The clickable numbers: a box over the number; Enter or leaving it applies, Escape doesn't.
  const startEdit = (id: string, value: number) => {
    if (readOnly) return;
    skipBlurRef.current = false;
    setEditing({ id, text: formatShapeMm(value) });
  };
  const applyEdit = (id: string, text: string) => {
    setEditing(null);
    const value = Number.parseFloat(String(text).replace(/,/g, "."));
    if (!Number.isFinite(value)) return;
    const [what, key] = id.split(":");
    if (what === "dim" && value > 0 && shape.kind !== "custom") {
      commitShape({ ...shape, params: clampTemplateParams(shape.kind, { ...shape.params, [key]: value }, key) });
    } else if (what === "seg" && value > 0) {
      // (A curved one keeps its height. Not kept if it'd make the outline cross itself.)
      const next = setCustomShapeSegmentLength(shape, Number(key), value, closed);
      if (customOutlineSelfIntersects(next.points ?? [], shapeBulges(next), closed)) refuseCrossing();
      else commitShape(next);
    } else if (what === "rad" && value >= 0) {
      commitShape(setShapeCornerRadius(shape, Number(key), value));
    } else if (what === "bulge" && value >= 0 && isCustom && closed) {
      // A curve's height (0: straight again) — bowing the way it already does, or out.
      const next = setCustomSegmentHeight(shape, Number(key), value);
      if (shapeSelfIntersects(next)) refuseCrossing();
      else if (JSON.stringify(shapeBulges(next)) !== JSON.stringify(shapeBulges(shape))) commitShape(next);
    }
  };

  // ---- A Custom outline's curves: each segment's handle (at its middle — a curve's, the middle of its curve), dragged
  // to bow it (pointer events, so a finger works as a mouse does), or clicked to type its height.
  const segmentHeight = (index: number) => {
    const edge = live?.edges[index];
    return edge?.curve ? edge.curve.height : 0;
  };
  const onHandlePointerDown = (index: number, event: ReactPointerEvent<SVGGElement>) => {
    if (readOnly || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragEndedRef.current = false;
    // (The view held still while it's dragged — the drawing doesn't move under the pointer.)
    setScale(s);
    setPan(origin);
    setCurveDrag({ index, pointerId: event.pointerId, start: [event.clientX, event.clientY], moved: false, bulge: shapeBulges(shape)[index] ?? 0 });
  };
  const onHandlePointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = curveDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.start[0], event.clientY - drag.start[1]) < DRAG_START_PX) return;
    const n = points.length;
    const p = points[drag.index];
    const q = points[(drag.index + 1) % n];
    const svg = event.currentTarget.ownerSVGElement;
    if (!p || !q || !svg) return;
    const box = svg.getBoundingClientRect();
    const at = toMm(event.clientX - box.left, event.clientY - box.top);
    const chord = distanceBetween(p, q);
    if (!(chord > 0)) return;
    // How far the pointer is off the segment, square to it (+: the side a + bulge bows to) — its height. Near the
    // segment: straight again; snap on, to 10mm; off, to 1mm.
    const side: ShapePoint = [-(q[1] - p[1]) / chord, (q[0] - p[0]) / chord];
    let height = v.dot(v.sub(at, v.mid(p, q)), side);
    if (Math.abs(height) * s < 6) height = 0;
    else height = snapOn ? Math.round(height / 10) * 10 : Math.round(height);
    setCurveDrag({ ...drag, moved: true, bulge: bulgeFromHeight(chord, height) });
  };
  const onHandlePointerUp = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = curveDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    setCurveDrag(null);
    // (Not moved: a click — the click that follows opens its height to type.)
    if (!drag.moved) return;
    dragEndedRef.current = true;
    const before = shapeBulges(shape)[drag.index] ?? 0;
    const next = setCustomSegmentBulge(shape, drag.index, drag.bulge);
    if (shapeSelfIntersects(next)) refuseCrossing();
    else if (Math.abs((shapeBulges(next)[drag.index] ?? 0) - before) > 1e-9) commitShape(next);
  };
  const onHandleClick = (index: number) => {
    if (dragEndedRef.current) {
      dragEndedRef.current = false;
      return;
    }
    startEdit(`bulge:${index}`, segmentHeight(index));
  };

  // ---- What it is, and a cabinet's own.
  // The shape as it's saved: what it is (as chosen) and, a cabinet, its height and shelves — its roles and through backs
  // as its edges have them. (Nothing of a cabinet kept on anything else.)
  const withWhatItIs = (next: CutlistShape): CutlistShape => {
    const out: CutlistShape = { ...next };
    delete out.base;
    delete out.cabinet;
    if (!base) return out;
    out.base = base;
    if (isCabinetShape(out)) {
      out.cabinet = { ...(next.cabinet ?? {}), height: cabinet.height, fixedShelves: cabinet.fixedShelves, adjustableShelves: cabinet.adjustableShelves };
    }
    return out;
  };
  const chooseBase = (partType: string) => {
    if (readOnly) return;
    const option = baseOptions?.find((candidate) => candidate.partType === partType);
    if (!option) return;
    setBase({ partType: option.partType, category: String(option.category ?? "").trim().toLowerCase() });
    setHoverRun(null);
    setHoverEdge(null);
    setHoverPart(null);
  };
  // A tap on a cabinet's edge: Doors → Back → End (a doors run as one); a back-to-back corner's swap; every edge back to
  // its default.
  const tapCabinetEdge = (edgeIndex: number) => {
    if (readOnly || !cabShape) return;
    commitShape(cycleCabinetEdgeRole(cabShape, edgeIndex));
  };
  const swapThroughBack = (corner: number) => {
    if (readOnly || !cabShape) return;
    commitShape(toggleCabinetThroughBack(cabShape, corner));
  };
  const resetRoles = () => {
    if (readOnly || !cabShape) return;
    commitShape(resetCabinetEdgeRoles(cabShape));
    setHoverEdge(null);
  };
  const applyHeight = (text: string) => {
    setHeightText(null);
    const value = Number.parseFloat(String(text).replace(/,/g, "."));
    if (!Number.isFinite(value) || value <= 0) return;
    const height = Math.min(4000, Math.max(Math.max(1, 2 * boardMm + 1), Math.round(value * 10) / 10));
    setCabinet((prev) => ({ ...prev, height }));
  };
  const stepShelves = (key: "fixedShelves" | "adjustableShelves", by: number) => {
    if (readOnly) return;
    setCabinet((prev) => ({ ...prev, [key]: Math.min(20, Math.max(0, prev[key] + by)) }));
  };

  const save = () => {
    if (readOnly || !live || drawing || crosses) return;
    const out = withWhatItIs(isCustom ? normalizeCustomShape(shape).shape : shape);
    const final = normalizeCutlistShape(cutlistShapeForStorage(out));
    if (final) onSave(final);
  };

  // Escape: the number being typed let go, else the editor closed. Ctrl/⌘ Z: a Custom outline's last step undone.
  const onWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      // (A menu open — What is it?: it closes itself, the editor stays.)
      if (document.querySelector('[data-glass-dropdown-menu="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      if (heightText !== null) {
        skipBlurRef.current = true;
        setHeightText(null);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      } else if (editing) {
        skipBlurRef.current = true;
        setEditing(null);
      } else {
        onClose();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z" && isCustom && !editing && heightText === null && !readOnly) {
      event.preventDefault();
      event.stopPropagation();
      undo();
    }
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => onWindowKeyDown(event);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  // ---- Drawing a Custom outline (pointer events, so a finger works as a mouse does): the point goes where it's let go.
  const localPoint = (event: ReactPointerEvent<SVGRectElement>): ShapePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return toMm(event.clientX - rect.left, event.clientY - rect.top);
  };
  const onDrawPointerDown = (event: ReactPointerEvent<SVGRectElement>) => {
    pressEndedEditRef.current = Boolean(editing);
    event.currentTarget.setPointerCapture(event.pointerId);
    setPointer(localPoint(event));
  };
  const onDrawPointerMove = (event: ReactPointerEvent<SVGRectElement>) => setPointer(localPoint(event));
  const onDrawPointerUp = (event: ReactPointerEvent<SVGRectElement>) => {
    const raw = localPoint(event);
    if (event.pointerType !== "mouse") setPointer(null);
    if (pressEndedEditRef.current) {
      pressEndedEditRef.current = false;
      return;
    }
    placePoint(raw);
  };
  const snapped = drawing && pointer && !readOnly ? snapCustomPoint(points, pointer, { snap: snapOn, mmPerPx: 1 / s }) : null;
  // (The next line would cross one already drawn — or, closing it, the line back would: shown red, and not taken.)
  const snappedCrosses = snapped
    ? snapped.closes
      ? customOutlineSelfIntersects(points, shapeBulges(shape), true)
      : points.length >= 2 && customOutlineSelfIntersects([...points, snapped.point], shapeBulges(shape), false)
    : false;

  // ---- Numbers on the drawing, never on top of each other (placeShapeLabels).
  const labelHeight = coarse ? 24 : 18;
  const labelWidth = (text: string) => Math.ceil(text.length * 7 + (coarse ? 16 : 12));
  const labels: EditorLabel[] = [];
  const dimLines: Array<{ key: string; a: ShapePoint; b: ShapePoint; extensions: Array<[ShapePoint, ShapePoint]> }> = [];
  if (live && !isCustom) {
    for (const d of templateDimensions(shape)) {
      const n = d.normal;
      const a = v.add(toScreen(d.from), v.mul(n, DIM_OFFSET));
      const b = v.add(toScreen(d.to), v.mul(n, DIM_OFFSET));
      // (From its points on the shape out to the line, a little past it.)
      const extension = (anchorMm: ShapePoint, end: ShapePoint): [ShapePoint, ShapePoint] => {
        const anchor = toScreen(anchorMm);
        return [v.add(anchor, v.mul(n, 4)), v.add(anchor, v.mul(n, v.dot(v.sub(end, anchor), n) + 5))];
      };
      dimLines.push({ key: d.key, a, b, extensions: [extension(d.fromAnchor, a), extension(d.toAnchor, b)] });
      const mid = v.mid(a, b);
      const text = formatShapeMm(d.value);
      labels.push({
        id: `dim:${d.key}`,
        text,
        value: d.value,
        editable: !readOnly,
        title: cutlistShapeParamLabel(shape.kind, d.key),
        width: labelWidth(text),
        height: labelHeight,
        x: mid[0],
        y: mid[1],
        anchor: mid,
        normal: n,
      });
    }
  }
  if (isCustom && points.length >= 2) {
    const count = closed ? points.length : points.length - 1;
    const centroid = v.mul(points.reduce<ShapePoint>((sum, p) => v.add(sum, p), [0, 0]), 1 / points.length);
    for (let i = 0; i < count; i += 1) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      const length = distanceBetween(p, q);
      if (length < 1e-6) continue;
      let normal: ShapePoint = live?.edges[i]?.normal ?? v.unit([q[1] - p[1], p[0] - q[0]]);
      if (!live && v.dot(normal, v.sub(v.mid(p, q), centroid)) < 0) normal = v.mul(normal, -1);
      // (A curve's: off the middle of its curve — its length still end to end.)
      const curve = live?.edges[i]?.curve ?? null;
      const mid = curve ? toScreen(curve.mid) : v.mid(toScreen(p), toScreen(q));
      const natural = v.add(mid, v.mul(normal, labelHeight / 2 + 6));
      const text = formatShapeMm(length);
      labels.push({
        id: `seg:${i}`,
        text,
        value: length,
        editable: !readOnly,
        title: curve ? "Length, end to end" : "Segment length",
        width: labelWidth(text),
        height: labelHeight,
        x: natural[0],
        y: natural[1],
        anchor: mid,
        normal,
      });
    }
  }
  // A curve's height ("⌒ 120"): between its chord and its curve when there's room, else out past its length.
  if (isCustom && live) {
    for (const edge of live.edges) {
      if (!edge.curve) continue;
      const arcMid = toScreen(edge.curve.mid);
      const chordMid = toScreen(v.mid(edge.startVertex, edge.endVertex));
      const roomInside = edge.curve.height * s > labelHeight + 10;
      const natural = roomInside ? v.mid(chordMid, arcMid) : v.add(arcMid, v.mul(edge.normal, labelHeight * 1.5 + 12));
      const text = `⌒ ${formatShapeMm(edge.curve.height)}`;
      labels.push({
        id: `bulge:${edge.index}`,
        text,
        value: edge.curve.height,
        editable: !readOnly,
        title: "Curve height (0 makes it straight)",
        width: labelWidth(text),
        height: labelHeight,
        x: natural[0],
        y: natural[1],
        anchor: arcMid,
        normal: roomInside ? v.unit(v.sub(chordMid, arcMid)) : edge.normal,
      });
    }
  }
  if (live) {
    for (const corner of live.corners) {
      // (An outside corner shows just a dot till it's rounded — below. One beside a curve can't be rounded at all.)
      if (corner.nextToCurve || (!corner.inside && !(corner.radius > 0))) continue;
      const anchor = toScreen(corner.tip);
      const natural = v.add(anchor, v.mul(corner.outward, 20));
      const text = `R${formatShapeMm(corner.radius)}`;
      labels.push({
        id: `rad:${corner.index}`,
        text,
        value: corner.radius,
        editable: !readOnly,
        title: corner.inside ? "Inside corner radius" : "Corner radius",
        width: labelWidth(text),
        height: labelHeight,
        x: natural[0],
        y: natural[1],
        anchor,
        normal: corner.outward,
      });
    }
  }
  const lastPoint = points[points.length - 1];
  if (snapped && lastPoint && snapped.length > 0) {
    const a = toScreen(lastPoint);
    const b = toScreen(snapped.point);
    const normal = v.unit([a[1] - b[1], b[0] - a[0]]);
    const mid = v.mid(a, b);
    const text = `${formatShapeMm(snapped.length)} · ${formatShapeMm(snapped.angle)}°`;
    labels.push({
      id: "live",
      text,
      value: snapped.length,
      editable: false,
      title: "",
      live: true,
      width: labelWidth(text),
      height: labelHeight,
      x: mid[0] + normal[0] * 16,
      y: mid[1] + normal[1] * 16,
      anchor: mid,
      normal,
    });
  }
  const placed = size.width > 0 ? placeShapeLabels(labels, size) : [];

  // ---- The summary.
  const outer = live ? live.bounds : pointsBounds(points);
  const footprint = live || points.length >= 2 ? `${formatShapeMm(outer.width)} × ${formatShapeMm(outer.height)} mm` : "—";
  // (A cabinet's banding: its shaped parts' doors edges, each as many times as there are of it.)
  const cabinetBandingMm = parts.reduce((sum, item) => sum + (item.shape ? shapeGeometry(item.shape).bandedLengthMm * item.quantity : 0), 0);
  const summary: Array<{ label: string; value: string }> = cabinetMode
    ? [
        { label: "Footprint", value: footprint },
        { label: "Height", value: `${formatShapeMm(cabinet.height)} mm` },
        { label: "Board", value: `${formatShapeMm(boardMm)} mm` },
        { label: "Edge banding", value: live ? `${formatShapeMetres(cabinetBandingMm)} m` : "—" },
      ]
    : [
        { label: "Cut size", value: footprint },
        { label: "Area", value: live ? `${(live.areaMm2 / 1e6).toFixed(2)} m²` : "—" },
        { label: "Edge banding", value: live ? `${formatShapeMetres(live.bandedLengthMm)} m` : "—" },
        { label: "Grain", value: grainLabel || "—" },
      ];
  const tap = coarse ? "Tap" : "Click";
  const hint = readOnly
    ? "View only."
    : drawing
      ? points.length
        ? `${tap} the first point to close.`
        : `${tap} to start drawing.`
      : cabinetMode && view === "2d"
        ? `${tap} an edge to make it doors, a back or an end.`
        : "";

  // A cabinet or a flat piece of one of the company's part types: washed in that part type's colour.
  const chosenOption = base ? baseOptions?.find((option) => option.partType === base.partType) : undefined;
  const wash = chosenOption?.color || color || "#CBD5E1";
  const baseDropdownOptions = [
    ...(baseOptions ?? []).map((option) => ({ value: option.partType, label: option.partType, color: option.color })),
    ...(base && !chosenOption ? [{ value: base.partType, label: base.partType || "—" }] : []),
  ];
  // A run as one line — its edges, and the curves of the corners between them — so its highlight never doubles up.
  const runPath = (runIndex: number) => (live ? shapeChainPath(live, shapeRunChain(live, runIndex), toScreen, s) : "");

  const renderLabel = (label: (typeof placed)[number]) => {
    const leader =
      label.moved && Math.hypot(label.anchor[0] - label.cx, label.anchor[1] - label.cy) > label.height / 2 + 4
        ? (() => {
            // (From the label's edge nearest what it's for.)
            const start: ShapePoint = [
              Math.min(Math.max(label.anchor[0], label.cx - label.width / 2), label.cx + label.width / 2),
              Math.min(Math.max(label.anchor[1], label.cy - label.height / 2), label.cy + label.height / 2),
            ];
            return { start, end: label.anchor };
          })()
        : null;
    const isEditing = editing?.id === label.id;
    return (
      <g key={label.id}>
        {leader ? (
          <g pointerEvents="none">
            <line x1={leader.start[0]} y1={leader.start[1]} x2={leader.end[0]} y2={leader.end[1]} stroke="var(--text-muted)" strokeWidth={0.9} />
            <polygon points={arrowHead(leader.end, leader.start, 5)} fill="var(--text-muted)" />
          </g>
        ) : null}
        <g
          role={label.editable ? "button" : undefined}
          tabIndex={label.editable ? 0 : undefined}
          aria-label={label.editable ? `${label.title}: ${label.text}` : undefined}
          style={{ cursor: label.editable ? "pointer" : "default", opacity: isEditing ? 0 : 1 }}
          pointerEvents={label.live ? "none" : undefined}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => label.editable && startEdit(label.id, label.value)}
          onKeyDown={(event) => {
            if (!label.editable || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            startEdit(label.id, label.value);
          }}
        >
          {label.editable ? <title>{label.title}</title> : null}
          <rect
            x={label.cx - label.width / 2}
            y={label.cy - label.height / 2}
            width={label.width}
            height={label.height}
            rx={label.height / 2}
            fill="var(--panel-bg)"
            fillOpacity={label.live ? 0.8 : 0.95}
            stroke={label.editable ? "color-mix(in srgb, var(--brand) 45%, transparent)" : "var(--glass-border)"}
            strokeWidth={1}
          />
          <text
            x={label.cx}
            y={label.cy}
            dy="0.35em"
            textAnchor="middle"
            fontSize={12}
            fontWeight={500}
            fill={label.editable ? "var(--brand-strong)" : label.live ? "var(--text-muted)" : "var(--text-main)"}
            style={{ userSelect: "none" }}
          >
            {label.text}
          </text>
        </g>
      </g>
    );
  };

  // The number box, over the number it's changing (or, an outside corner's dot, beside it).
  const editBox = (() => {
    if (!editing) return null;
    const label = placed.find((item) => item.id === editing.id);
    let at: { x: number; y: number; width: number } | null = label ? { x: label.cx, y: label.cy, width: label.width } : null;
    if (!at && live && editing.id.startsWith("rad:")) {
      const corner = live.corners[Number(editing.id.split(":")[1])];
      if (corner) {
        const p = v.add(toScreen(corner.tip), v.mul(corner.outward, 22));
        at = { x: p[0], y: p[1], width: 40 };
      }
    }
    // (A straight segment's curve height: beside its handle.)
    if (!at && live && editing.id.startsWith("bulge:")) {
      const edge = live.edges[Number(editing.id.split(":")[1])];
      if (edge) {
        const p = v.add(toScreen(edge.curve ? edge.curve.mid : v.mid(edge.startVertex, edge.endVertex)), v.mul(edge.normal, 24));
        at = { x: p[0], y: p[1], width: 40 };
      }
    }
    if (!at) return null;
    const width = Math.max(68, at.width + 22);
    const height = coarse ? 34 : 28;
    const left = Math.min(Math.max(4, at.x - width / 2), Math.max(4, size.width - width - 4));
    const top = Math.min(Math.max(4, at.y - height / 2), Math.max(4, size.height - height - 4));
    const { id, text } = editing;
    return (
      <input
        key={id}
        autoFocus
        inputMode="decimal"
        aria-label="Value in mm"
        value={text}
        onChange={(event) => setEditing({ id, text: event.target.value })}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          skipBlurRef.current = true;
          applyEdit(id, text);
        }}
        onBlur={() => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          applyEdit(id, text);
        }}
        className="absolute z-10 rounded-full border px-2 text-center text-[13px] font-medium outline-none"
        style={{
          left,
          top,
          width,
          height,
          borderColor: "var(--brand)",
          backgroundColor: "var(--panel-bg)",
          color: "var(--text-main)",
          boxShadow: "0 4px 14px rgba(15, 23, 42, 0.18)",
        }}
      />
    );
  })();

  // ---- 2D.
  const render2d = () => {
    const hit = coarse ? 22 : 14;
    // The 100mm grid behind a Custom outline (500mm when 100 would be too close together).
    const grid = (() => {
      if (!isCustom || size.width <= 0) return null;
      const step = 100 * s >= 7 ? 100 : 500;
      const from = toMm(0, 0);
      const to = toMm(size.width, size.height);
      const lines: ReactNode[] = [];
      const firstX = Math.ceil(from[0] / step) * step;
      const firstY = Math.ceil(from[1] / step) * step;
      for (let x = firstX; x <= to[0] && lines.length < 400; x += step) {
        const sx = toScreen([x, 0])[0];
        lines.push(<line key={`gx${x}`} x1={sx} y1={0} x2={sx} y2={size.height} strokeOpacity={Math.round(x) % 1000 === 0 ? 0.12 : 0.06} />);
      }
      for (let y = firstY; y <= to[1] && lines.length < 800; y += step) {
        const sy = toScreen([0, y])[1];
        lines.push(<line key={`gy${y}`} x1={0} y1={sy} x2={size.width} y2={sy} strokeOpacity={Math.round(y) % 1000 === 0 ? 0.12 : 0.06} />);
      }
      return (
        <g stroke="var(--text-main)" strokeWidth={1} pointerEvents="none">
          {lines}
        </g>
      );
    })();
    // (A Custom outline: a finger drawing, or dragging a curve's handle, isn't taken as a scroll or zoom — set on the
    // whole drawing, as not every browser heeds touch-action on the handle itself.)
    return (
      <svg
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
        className="absolute inset-0 select-none"
        style={{ touchAction: drawing || (isCustom && !readOnly) ? "none" : "manipulation" }}
      >
        {drawing && !readOnly ? (
          <rect
            x={0}
            y={0}
            width={size.width}
            height={size.height}
            fill="transparent"
            style={{ cursor: "crosshair" }}
            onPointerDown={onDrawPointerDown}
            onPointerMove={onDrawPointerMove}
            onPointerUp={onDrawPointerUp}
            onPointerCancel={() => setPointer(null)}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setPointer(null);
            }}
          />
        ) : null}
        {grid}
        {live ? (
          <>
            <path d={shapeOutlinePath(live, toScreen, s)} fill={wash} fillOpacity={0.2} stroke="none" pointerEvents="none" />
            {/* A cabinet's backs and ends as their panels lie, a board thick (which back runs through shows); a part
                hovered in its list picked out. */}
            {cabinetMode && model ? (
              <g pointerEvents="none">
                {model.prisms
                  .filter((prism) => prism.kind === "back" || prism.kind === "end")
                  .map((prism) => (
                    <polygon
                      key={`panel${prism.key}`}
                      points={pts(prism.polygon.map(toScreen))}
                      fill={CABINET_EDGE_ROLE_COLORS[prism.kind === "back" ? "back" : "end"]}
                      fillOpacity={hoverPart === prism.part ? 0.75 : 0.32}
                      stroke="none"
                    />
                  ))}
                {(() => {
                  const picked = hoverPart ? model.prisms.find((prism) => prism.part === hoverPart && prism.kind !== "back" && prism.kind !== "end") : null;
                  return picked ? (
                    <polygon points={pts(picked.polygon.map(toScreen))} fill="var(--brand)" fillOpacity={0.12} stroke="var(--brand)" strokeWidth={1.5} strokeDasharray="6 4" />
                  ) : null;
                })()}
              </g>
            ) : null}
            {cabinetMode && hoverEdge !== null && !curveDrag && live.edges[hoverEdge] ? (
              <path
                d={shapeChainPath(
                  live,
                  roles[hoverEdge] === "doors" ? shapeRunChain(live, live.edges[hoverEdge].run) : { edges: [hoverEdge], closed: false },
                  toScreen,
                  s,
                )}
                fill="none"
                stroke="var(--brand)"
                strokeOpacity={0.3}
                strokeWidth={11}
                strokeLinecap="round"
                strokeLinejoin="round"
                pointerEvents="none"
              />
            ) : null}
            {/* The run under the pointer: one line through its edges and curves — round where it bends, round at its
                two ends, nothing doubled up. (A cabinet's: the edge under it, or its whole doors run.) */}
            {!cabinetMode && hoverRun !== null && !curveDrag ? (
              <path
                d={runPath(hoverRun)}
                fill="none"
                stroke="var(--brand)"
                strokeOpacity={0.3}
                strokeWidth={11}
                strokeLinecap="round"
                strokeLinejoin="round"
                pointerEvents="none"
              />
            ) : null}
            <path
              d={shapeOutlinePath(live, toScreen, s)}
              fill="none"
              stroke={dragCrosses ? "var(--danger)" : "var(--text-main)"}
              strokeWidth={1.5}
              strokeLinejoin="round"
              pointerEvents="none"
            />
            {/* A cabinet: each edge in its role's colour (doors, back, end). */}
            {cabinetMode
              ? cabinetRoleChains(live, roles).map(({ role, chain }) => (
                  <path
                    key={`role${chain.edges[0]}`}
                    d={shapeChainPath(live, chain, toScreen, s)}
                    fill="none"
                    stroke={CABINET_EDGE_ROLE_COLORS[role]}
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                ))
              : null}
            {/* Each banded stretch as one line, the same way. */}
            {(cabinetMode ? [] : shapeBandedChains(live)).map((chain) => (
              <path
                key={`band${chain.edges[0]}`}
                d={shapeChainPath(live, chain, toScreen, s)}
                fill="none"
                stroke={CUTLIST_SHAPE_BAND_COLOR}
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
                pointerEvents="none"
              />
            ))}
            {/* A cabinet's edges, each clickable: Doors → Back → End (a doors run as one). */}
            {cabinetMode && !readOnly
              ? live.edges.map((edge) => {
                  const role = roles[edge.index];
                  const label = role ? CABINET_EDGE_ROLE_LABELS[role] : "Edge";
                  return (
                    <g
                      key={`edge${edge.index}`}
                      role="button"
                      aria-label={`${label} — click to change`}
                      style={{ cursor: "pointer" }}
                      onPointerEnter={() => setHoverEdge(edge.index)}
                      onPointerLeave={() => setHoverEdge((prev) => (prev === edge.index ? null : prev))}
                      onClick={() => tapCabinetEdge(edge.index)}
                    >
                      <title>{`${label} — click for ${role === "doors" ? "a back" : role === "back" ? "an end" : "doors"}`}</title>
                      <path
                        d={shapeChainPath(live, { edges: [edge.index], closed: false }, toScreen, s)}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={hit}
                        strokeLinecap="round"
                        pointerEvents="stroke"
                      />
                    </g>
                  );
                })
              : null}
            {/* Each run's edges and curves, clickable as one: banded or not. */}
            {!readOnly && !cabinetMode
              ? live.runs.map((run) => (
                  <g
                    key={`run${run.index}`}
                    role="button"
                    aria-label={run.banded ? "Edge banded — click to take it off" : "Edge — click to band it"}
                    style={{ cursor: "pointer" }}
                    onPointerEnter={() => setHoverRun(run.index)}
                    onPointerLeave={() => setHoverRun((prev) => (prev === run.index ? null : prev))}
                    onClick={() => commitShape(toggleShapeRunBanding(shape, run.edges[0]))}
                  >
                    <title>{run.banded ? "Banded — click to take it off" : "Click to band this edge"}</title>
                    <path d={runPath(run.index)} fill="none" stroke="transparent" strokeWidth={hit} strokeLinecap="round" strokeLinejoin="round" pointerEvents="stroke" />
                  </g>
                ))
              : null}
            {/* A Custom outline's curve handles: one at each segment's middle (a curve's, the middle of its curve) —
                dragged to bow it, clicked to type its height. */}
            {isCustom && !readOnly
              ? live.edges.map((edge) => {
                  const at = toScreen(edge.curve ? edge.curve.mid : v.mid(edge.startVertex, edge.endVertex));
                  const active = curveDrag?.index === edge.index;
                  const tone = active && dragCrosses ? "var(--danger)" : "var(--brand)";
                  return (
                    <g
                      key={`handle${edge.index}`}
                      role="button"
                      tabIndex={0}
                      aria-label={edge.curve ? `Curve, ${formatShapeMm(edge.curve.height)} high — drag to change it` : "Drag to curve this edge"}
                      style={{ cursor: active && curveDrag?.moved ? "grabbing" : "grab", touchAction: "none" }}
                      onPointerDown={(event) => onHandlePointerDown(edge.index, event)}
                      onPointerMove={onHandlePointerMove}
                      onPointerUp={onHandlePointerUp}
                      onPointerCancel={() => setCurveDrag(null)}
                      onClick={(event) => {
                        event.stopPropagation();
                        onHandleClick(edge.index);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        startEdit(`bulge:${edge.index}`, segmentHeight(edge.index));
                      }}
                    >
                      <title>{edge.curve ? "Drag to change the curve, or click to type its height" : "Drag to curve this edge, or click to type how high"}</title>
                      <circle cx={at[0]} cy={at[1]} r={coarse ? 16 : 9} fill="transparent" />
                      <circle
                        cx={at[0]}
                        cy={at[1]}
                        r={active ? 5.5 : coarse ? 5 : 4}
                        fill={edge.curve || active ? tone : "var(--panel-bg)"}
                        stroke={tone}
                        strokeWidth={1.5}
                      />
                    </g>
                  );
                })
              : null}
          </>
        ) : null}
        {/* A Custom outline being drawn: its points and lines so far, and the next line to the pointer. */}
        {drawing ? (
          <g pointerEvents="none">
            {points.length >= 2 ? (
              <polyline points={pts(points.map(toScreen))} fill="none" stroke="var(--text-main)" strokeWidth={1.5} strokeLinejoin="round" />
            ) : null}
            {snapped && lastPoint ? (
              <line
                x1={toScreen(lastPoint)[0]}
                y1={toScreen(lastPoint)[1]}
                x2={toScreen(snapped.point)[0]}
                y2={toScreen(snapped.point)[1]}
                stroke={snappedCrosses ? "var(--danger)" : "var(--brand)"}
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
            ) : null}
            {snapped?.guide ? (
              <line
                x1={toScreen(snapped.guide.from)[0]}
                y1={toScreen(snapped.guide.from)[1]}
                x2={toScreen(snapped.guide.to)[0]}
                y2={toScreen(snapped.guide.to)[1]}
                stroke="var(--brand)"
                strokeOpacity={0.7}
                strokeWidth={1}
                strokeDasharray="1.5 3.5"
              />
            ) : null}
            {points.map((p, i) => {
              const sp = toScreen(p);
              const closing = i === 0 && snapped?.closes;
              return (
                <g key={`pt${i}`}>
                  {i === 0 && points.length >= 3 ? (
                    <circle cx={sp[0]} cy={sp[1]} r={closing ? 10 : 7} fill="var(--brand)" fillOpacity={closing ? 0.25 : 0.1} stroke="var(--brand)" strokeWidth={1} />
                  ) : null}
                  <circle cx={sp[0]} cy={sp[1]} r={3.5} fill={i === 0 ? "var(--brand)" : "var(--text-main)"} />
                </g>
              );
            })}
            {snapped ? <circle cx={toScreen(snapped.point)[0]} cy={toScreen(snapped.point)[1]} r={4} fill="none" stroke="var(--brand)" strokeWidth={1.5} /> : null}
          </g>
        ) : null}
        {/* A template's dimension lines. */}
        {dimLines.map((dim) => {
          const long = Math.hypot(dim.b[0] - dim.a[0], dim.b[1] - dim.a[1]) > 18;
          const mid = v.mid(dim.a, dim.b);
          return (
            <g key={`dim${dim.key}`} pointerEvents="none" stroke="var(--text-muted)" fill="var(--text-muted)">
              {dim.extensions.map(([a, b], i) => (
                <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={0.75} />
              ))}
              <line x1={dim.a[0]} y1={dim.a[1]} x2={dim.b[0]} y2={dim.b[1]} strokeWidth={1} />
              {long ? (
                <>
                  <polygon points={arrowHead(dim.a, mid, 6)} stroke="none" />
                  <polygon points={arrowHead(dim.b, mid, 6)} stroke="none" />
                </>
              ) : null}
            </g>
          );
        })}
        {/* Corners: an outside one a dot till it's rounded (its radius then, as every inside corner's always is). */}
        {live && !readOnly
          ? live.corners
              .filter((corner) => !corner.inside && !(corner.radius > 0) && !corner.nextToCurve)
              .map((corner) => {
                const p = toScreen(corner.point);
                const editingThis = editing?.id === `rad:${corner.index}`;
                return (
                  <g
                    key={`dot${corner.index}`}
                    role="button"
                    tabIndex={0}
                    aria-label="Round this corner"
                    style={{ cursor: "pointer" }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => startEdit(`rad:${corner.index}`, 0)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      startEdit(`rad:${corner.index}`, 0);
                    }}
                  >
                    <title>Round this corner</title>
                    <circle cx={p[0]} cy={p[1]} r={coarse ? 12 : 7} fill="transparent" />
                    <circle cx={p[0]} cy={p[1]} r={editingThis ? 4.5 : 3} fill="var(--brand)" fillOpacity={editingThis ? 1 : 0.75} stroke="var(--panel-bg)" strokeWidth={1} />
                  </g>
                );
              })
          : null}
        {/* A cabinet's back-to-back corners: which back runs through, swapped. */}
        {cabinetMode && live && !readOnly
          ? backCorners.map((meeting) => {
              const corner = live.corners[meeting.corner];
              if (!corner) return null;
              const at = v.add(toScreen(corner.point), v.mul(corner.outward, coarse ? -36 : -30));
              const r = coarse ? 14 : 10;
              const tone = CABINET_EDGE_ROLE_COLORS.back;
              const [x, y] = at;
              return (
                <g
                  key={`swap${meeting.corner}`}
                  role="button"
                  tabIndex={0}
                  aria-label="Swap which back runs through"
                  style={{ cursor: "pointer" }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => swapThroughBack(meeting.corner)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    swapThroughBack(meeting.corner);
                  }}
                >
                  <title>Swap which back runs through</title>
                  <circle cx={x} cy={y} r={r} fill="var(--panel-bg)" stroke={tone} strokeWidth={1.3} />
                  <path
                    d={[
                      `M ${x - 5} ${y - 2.5} H ${x + 5}`,
                      `M ${x + 2.8} ${y - 4.7} L ${x + 5} ${y - 2.5} L ${x + 2.8} ${y - 0.3}`,
                      `M ${x + 5} ${y + 2.5} H ${x - 5}`,
                      `M ${x - 2.8} ${y + 0.3} L ${x - 5} ${y + 2.5} L ${x - 2.8} ${y + 4.7}`,
                    ].join(" ")}
                    fill="none"
                    stroke={tone}
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })
          : null}
        {placed.map(renderLabel)}
      </svg>
    );
  };

  // ---- 3D: an isometric slab, its thickness shown three times over so it reads.
  const slab = useMemo(() => (live ? shapeSlabFaces(live, Math.max(1, thicknessMm) * 3) : null), [live, thicknessMm]);
  const render3d = () => {
    if (!slab || !slab.top.length) {
      return (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>
          Close the outline to see it in 3D.
        </div>
      );
    }
    const all = [...slab.top, ...slab.sides.flatMap((face) => face.points)];
    const b = pointsBounds(all);
    const margin = Math.min(56, Math.max(24, Math.min(size.width, size.height) * 0.1));
    const k = Math.max(1e-4, Math.min(Math.max(40, size.width - 2 * margin) / Math.max(b.width, 1), Math.max(40, size.height - 2 * margin) / Math.max(b.height, 1)));
    const ox = size.width / 2 - (b.minX + b.width / 2) * k;
    const oy = size.height / 2 - (b.minY + b.height / 2) * k;
    const at = (p: ShapePoint): ShapePoint => [ox + p[0] * k, oy + p[1] * k];
    const top = mixHex(wash, "#FFFFFF", 0.62);
    const light = mixHex(wash, "#FFFFFF", 0.25);
    const dark = mixHex(wash, "#0F172A", 0.22);
    const edgeStroke = mixHex(wash, "#0F172A", 0.55);
    return (
      <svg width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} className="absolute inset-0 select-none">
        {slab.sides.map((face, i) => {
          // (Lit from the right: a side facing that way lighter, one facing the front darker.)
          const t = Math.min(1, Math.max(0, (face.normal[0] - face.normal[1] + 1) / 2));
          const fill = face.banded ? mixHex(CUTLIST_SHAPE_BAND_COLOR, "#FFFFFF", 0.35 - t * 0.2) : mixHex(dark, light, t);
          return <polygon key={i} points={pts(face.points.map(at))} fill={fill} stroke={fill} strokeWidth={0.6} strokeLinejoin="round" />;
        })}
        <polygon points={pts(slab.top.map(at))} fill={top} stroke={edgeStroke} strokeWidth={1.2} strokeLinejoin="round" />
        <text x={14} y={size.height - 14} fontSize={11} fontWeight={500} fill="var(--text-muted)">
          Thickness shown ×3
        </text>
      </svg>
    );
  };

  // ---- The pop-up.
  const toolButtonClass =
    "glass-shine glass-shine-neutral inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium text-[var(--text-main)] transition hover:brightness-[0.97] disabled:opacity-45";
  const subtitle = [partType, room].map((part) => String(part || "").trim()).filter(Boolean).join(" · ");
  return (
    <>
      <GlassModalHeader
        icon={<Shapes />}
        title={
          <>
            Custom shape
            {subtitle ? (
              <span className="ml-2 text-[13px] font-medium normal-case tracking-normal" style={{ color: "var(--text-muted)" }}>
                {subtitle}
              </span>
            ) : null}
          </>
        }
        onClose={onClose}
      >
        <Segmented
          size="sm"
          pill
          tone="brand"
          value={view}
          options={[
            { value: "2d", label: "2D" },
            { value: "3d", label: "3D" },
          ]}
          onChange={(next) => {
            setView(next);
            setEditing(null);
            setHoverRun(null);
            setHoverEdge(null);
          }}
        />
      </GlassModalHeader>

      <div className="flex shrink-0 flex-col gap-2 px-5 pb-2 pt-3">
        {baseOptions?.length ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                What is it?
              </span>
              <GlassDropdown
                value={base?.partType ?? ""}
                options={baseDropdownOptions}
                onChange={chooseBase}
                placeholder="Choose…"
                ariaLabel="What is it?"
                disabled={readOnly}
                menuMinWidth={180}
                triggerClassName="glass-shine glass-shine-neutral h-8 min-w-[150px] max-w-[240px] rounded-full border px-3 text-[12px] font-medium text-[var(--text-main)]"
              />
            </div>
            {cabinetMode ? (
              <>
                <label className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                  Height
                  <input
                    inputMode="decimal"
                    aria-label="Cabinet height (mm)"
                    disabled={readOnly}
                    value={heightText ?? formatShapeMm(cabinet.height)}
                    onFocus={(event) => {
                      setHeightText(formatShapeMm(cabinet.height));
                      event.currentTarget.select();
                    }}
                    onChange={(event) => setHeightText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      skipBlurRef.current = true;
                      applyHeight(event.currentTarget.value);
                      event.currentTarget.blur();
                    }}
                    onBlur={(event) => {
                      if (skipBlurRef.current) {
                        skipBlurRef.current = false;
                        setHeightText(null);
                        return;
                      }
                      applyHeight(event.currentTarget.value);
                    }}
                    className="h-8 w-[68px] rounded-full border px-2 text-center text-[12.5px] font-medium outline-none transition focus:border-[var(--brand)] disabled:opacity-60"
                    style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                  />
                  mm
                </label>
                {(
                  [
                    { key: "fixedShelves", label: "Fixed shelves" },
                    { key: "adjustableShelves", label: "Adjustable shelves" },
                  ] as const
                ).map((counter) => (
                  <div key={counter.key} className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                    {counter.label}
                    <div className="inline-flex h-8 items-center rounded-full border" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
                      <button
                        type="button"
                        aria-label={`One fewer ${counter.label.toLowerCase()}`}
                        disabled={readOnly || cabinet[counter.key] <= 0}
                        onClick={() => stepShelves(counter.key, -1)}
                        className="inline-flex h-8 w-7 items-center justify-center rounded-full text-[var(--text-main)] transition hover:brightness-90 disabled:opacity-35"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="min-w-[18px] text-center text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
                        {cabinet[counter.key]}
                      </span>
                      <button
                        type="button"
                        aria-label={`One more ${counter.label.toLowerCase().replace(/s$/, "")}`}
                        disabled={readOnly || cabinet[counter.key] >= 20}
                        onClick={() => stepShelves(counter.key, 1)}
                        className="inline-flex h-8 w-7 items-center justify-center rounded-full text-[var(--text-main)] transition hover:brightness-90 disabled:opacity-35"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {EDITOR_KINDS.map((option) => {
            const active = option.kind === shape.kind;
            return (
              <button
                key={option.kind}
                type="button"
                disabled={readOnly && !active}
                aria-pressed={active}
                onClick={() => switchKind(option.kind)}
                className={`glass-shine inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition hover:brightness-[0.97] disabled:opacity-45 ${
                  active ? "text-white" : "glass-shine-neutral text-[var(--text-main)]"
                }`}
                style={active ? glassShineStyle("var(--brand)") : undefined}
              >
                <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
                  <polygon points={KIND_GLYPHS[option.kind]} fill="currentColor" fillOpacity={0.18} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
                </svg>
                {option.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setScale(null);
              setPan(null);
            }}
            className={`${toolButtonClass} ml-auto`}
            title="Fit the drawing to the view"
          >
            <Maximize2 size={13} />
            Fit
          </button>
        </div>
        {isCustom && !readOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={snapOn}
              onClick={() => setSnapOn((on) => !on)}
              className={`glass-shine inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition hover:brightness-[0.97] ${
                snapOn ? "text-white" : "glass-shine-neutral text-[var(--text-main)]"
              }`}
              style={snapOn ? glassShineStyle("var(--brand)") : undefined}
              title="Snap to points, 45° and 10mm"
            >
              <Magnet size={13} />
              Snap {snapOn ? "on" : "off"}
            </button>
            <button type="button" disabled={!history.length} onClick={undo} className={toolButtonClass}>
              <Undo2 size={13} />
              Undo
            </button>
            <button type="button" disabled={!points.length} onClick={clearDrawing} className={toolButtonClass}>
              <Eraser size={13} />
              Clear
            </button>
            <button type="button" disabled={!canClose} onClick={closeOutline} className={toolButtonClass}>
              <Check size={13} />
              Close shape
            </button>
            {hint ? (
              <p className="min-w-0 flex-1 truncate text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                {hint}
              </p>
            ) : null}
          </div>
        ) : hint ? (
          <p className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
            {hint}
          </p>
        ) : null}
      </div>

      <div
        ref={stageRef}
        data-swipe-close="off"
        className="relative mx-5 min-h-[220px] flex-1 overflow-hidden rounded-[14px] border"
        style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 70%, transparent)" }}
      >
        {size.width > 0 && size.height > 0 ? (
          view === "3d" ? (
            cabinetMode ? (
              <CutlistCabinet3d
                model={model ?? { prisms: [], height: 0, thicknessMm: 0, bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 } }}
                width={size.width}
                height={size.height}
                color={wash}
                highlight={hoverPart}
              />
            ) : (
              render3d()
            )
          ) : (
            render2d()
          )
        ) : null}
        {view === "2d" ? editBox : null}
        {/* A cabinet's roles, what colour each is (and every edge back as it started). */}
        {cabinetMode && view === "2d" && live ? (
          <div
            className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-full border px-3 py-1 text-[11.5px] font-medium"
            style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 88%, transparent)", color: "var(--text-main)" }}
          >
            {CABINET_EDGE_ROLES.map((role) => (
              <span key={role} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-[4px] w-4 rounded-full" style={{ backgroundColor: CABINET_EDGE_ROLE_COLORS[role] }} />
                {CABINET_EDGE_ROLE_LABELS[role]}
              </span>
            ))}
            {hasRoleChanges && !readOnly ? (
              <button
                type="button"
                onClick={resetRoles}
                className="inline-flex items-center gap-1 rounded-full text-[11.5px] font-medium transition hover:brightness-90"
                style={{ color: "var(--brand-strong)" }}
                title="Every edge back to its default"
              >
                <RotateCcw size={11} />
                Reset
              </button>
            ) : null}
          </div>
        ) : null}
        {/* A change that would make the outline cross itself (not made), or an outline that does (Save's off). */}
        {message && view === "2d" ? (
          <div
            key={notice && !dragCrosses && !crosses ? notice.id : "crossing"}
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute left-1/2 top-3 z-20 max-w-[calc(100%-24px)] -translate-x-1/2 truncate rounded-full border px-3 py-1 text-[12px] font-medium"
            style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
          >
            {message}
          </div>
        ) : null}
      </div>

      {/* A cabinet's parts, worked out as it's drawn (hovered: picked out on the drawing). */}
      {cabinetMode ? (
        <div className="mx-5 mt-2 shrink-0 overflow-hidden rounded-[14px] border" style={{ borderColor: "var(--glass-border)" }}>
          <div
            className="grid grid-cols-[minmax(0,1fr)_48px_minmax(0,1.2fr)] gap-x-3 border-b px-3 py-1.5 text-[11px] font-medium"
            style={{ borderColor: "var(--glass-border)", color: "var(--text-muted)" }}
          >
            <span>Part</span>
            <span className="text-right">Qty</span>
            <span>Size (H × W)</span>
          </div>
          <div className="glass-scroll max-h-[132px] overflow-y-auto" onPointerLeave={() => setHoverPart(null)}>
            {parts.length ? (
              parts.map((item) => {
                const swatch =
                  item.name === "Back" ? CABINET_EDGE_ROLE_COLORS.back : item.name === "End" ? CABINET_EDGE_ROLE_COLORS.end : null;
                return (
                  <div
                    key={item.key}
                    className="grid grid-cols-[minmax(0,1fr)_48px_minmax(0,1.2fr)] items-center gap-x-3 px-3 py-1 text-[12.5px] font-medium transition-colors"
                    style={{
                      color: "var(--text-main)",
                      backgroundColor: hoverPart === item.key ? "color-mix(in srgb, var(--brand) 10%, transparent)" : undefined,
                    }}
                    onPointerEnter={() => setHoverPart(item.key)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {item.shape ? (
                        <CutlistShapeThumbnail shape={item.shape} color={wash} width={26} height={18} />
                      ) : (
                        <span aria-hidden="true" className="inline-flex h-[18px] w-[26px] shrink-0 items-center justify-center">
                          <span className="h-[4px] w-4 rounded-full" style={{ backgroundColor: swatch ?? "var(--text-muted)" }} />
                        </span>
                      )}
                      <span className="truncate">{item.name}</span>
                    </span>
                    <span className="text-right">{item.quantity}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      {item.problem ? (
                        <span className="truncate" style={{ color: "var(--danger-strong)" }}>
                          {item.problem}
                        </span>
                      ) : (
                        <span className="whitespace-nowrap">
                          {formatShapeMm(item.height ?? 0)} × {formatShapeMm(item.width ?? 0)}
                        </span>
                      )}
                      {item.kind === "shape" ? (
                        <span
                          className="shrink-0 rounded-full border px-1.5 text-[10.5px] font-medium"
                          style={{ borderColor: "var(--glass-border)", color: "var(--text-muted)" }}
                        >
                          shaped
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="px-3 py-2 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                {drawing ? "Close the outline to work out its parts." : "Nothing to make yet."}
              </p>
            )}
          </div>
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        {summary.map((item) => (
          <div key={item.label} className="min-w-0">
            <p className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
              {item.label}
            </p>
            <p className="whitespace-nowrap text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
              {item.value}
            </p>
          </div>
        ))}
        {!readOnly ? (
          <button
            type="button"
            disabled={!live || drawing || crosses}
            title={crosses ? CROSSING_MESSAGE : undefined}
            onClick={save}
            className="glass-shine ml-auto inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-6 text-[14px] font-medium text-white transition hover:brightness-95 disabled:opacity-50"
            style={glassShineStyle("var(--brand)")}
          >
            <Check size={15} strokeWidth={2.6} />
            {isNew ? "Add piece" : "Save shape"}
          </button>
        ) : null}
      </div>
    </>
  );
}
