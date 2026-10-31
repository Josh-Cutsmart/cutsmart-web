"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowRightLeft,
  ChevronDown,
  Check,
  CircleHelp,
  Download,
  Eraser,
  FileText,
  FlipHorizontal2,
  FlipVertical2,
  Grid3x3,
  Image as ImageIcon,
  Magnet,
  Maximize2,
  Minus,
  MousePointer2,
  PenLine,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Ruler,
  RulerDimensionLine,
  Scissors,
  Shapes,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { GLASS_MENU_CLASS, GLASS_MENU_ROW_CLASS, GLASS_MENU_STYLE, GlassActionMenu, GlassDropdown } from "@/components/glass-dropdown";
import { Segmented, glassFieldClass } from "@/components/settings-ui";
import { CUTLIST_SHAPE_BAND_COLOR, CutlistShapeThumbnail } from "@/components/cutlist-shape-thumbnail";
import { CABINET_3D_DEFAULT_VIEW, CutlistCabinet3d, readCabinetRolesShown, type Cabinet3dFace } from "@/components/cutlist-cabinet-3d";
import { type View3dTurnStart } from "@/lib/use-view-3d-gestures";
import { downloadShapeDrawingPdf, downloadShapeDrawingPng, shapeExportFileName, type ShapeDrawingBuilder } from "@/lib/cutlist-shape-export";
import { shapeDrawingOps } from "@/lib/cutlist-shape-render";
import { useUndo } from "@/components/undo-bar";
import {
  CABINET_EDGE_ROLES,
  CABINET_EDGE_ROLE_COLORS,
  CABINET_EDGE_ROLE_LABELS,
  cabinetBackCorners,
  cabinetEdgeRoles,
  cabinetRoleChains,
  cabinetSettings,
  customCabinetModel,
  cabinet3dDrawingOps,
  cabinetPlanDrawingOps,
  customCabinetBanding,
  customCabinetParts,
  customCabinetPartClashingText,
  flatPieceModel,
  cycleCabinetEdgeRole,
  resetCabinetEdgeRoles,
  setCabinetEdgeRole,
  toggleCabinetThroughBack,
  type CabinetSettings,
  type CabinetView,
} from "@/lib/cutlist-cabinet-shape";
import { glassShineStyle } from "@/lib/glass-shine";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";
import { useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import {
  CUTLIST_SHAPE_KINDS,
  DEFAULT_CABINET_HEIGHT,
  bulgeFromHeight,
  clampTemplateParams,
  createCustomShape,
  createTemplateShape,
  customOutlineSelfIntersects,
  cutlistShapeForStorage,
  cutlistShapeParamLabel,
  distanceBetween,
  formatShapeDegrees,
  formatShapeMetres,
  formatShapeMm,
  isCabinetShape,
  isTemplateShapeKind,
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
  shapeCornerAngles,
  shapeCutoutDimensions,
  shapeCutPieceAt,
  shapeGeometry,
  shapeOutlinePath,
  shapeRunChain,
  shapeSelfIntersects,
  shapeVertices,
  signedPolygonArea,
  snapCustomPoint,
  templateDimensions,
  toggleShapeRunBanding,
  transformShape,
  cutShapeFace,
  cutShapeLinePiece,
  type CabinetEdgeRole,
  type CustomSnap,
  type CutlistShape,
  type CutlistShapeBase,
  type CutlistShapeKind,
  type CutlistShapeTemplateKind,
  type ShapeBounds,
  type ShapeCutLine,
  type ShapeTransform,
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
// (not banded — clicked through, or picked from an edge's own menu), it has a height and shelves, and its parts are
// worked out beside it (lib/cutlist-cabinet-shape.ts); 3D shows it as a closed cabinet in the board's thickness
// (components/cutlist-cabinet-3d.tsx).
//
// Laid out as the drawing, and beside it (under it, on a phone) a panel: its row's own fields (Part name, Board,
// Quantity, Information, Grain — those its cutlist shows), what it is, a cabinet's parts, and its sizes; Save at its foot.

// How far a template's dimension lines sit off its outline (px).
const DIM_OFFSET = 30;
// The area an empty drawing starts on (mm).
const DRAW_AREA: ShapeBounds = { minX: 0, minY: 0, maxX: 2400, maxY: 1400, width: 2400, height: 1400 };
// What's said when a change would make the outline cross itself (and it isn't made).
const CROSSING_MESSAGE = "That would cross another line";
// How far a curve's handle moves before it's a drag, not a click (px).
const DRAG_START_PX = 4;
// A press on a cabinet's edge held this long, not moving more than this, is a long press (a touch screen's right-click).
const HOLD_MS = 500;
const HOLD_SLOP_PX = 8;
// How far a right-button drag on the 2D drawing goes before it's a turn in 3D, not a right-click (px).
const RIGHT_DRAG_PX = 5;
// The row's fields it can set, as its cutlist's columns name them.
const ALL_FIELDS: ReadonlyArray<CutlistShapeEditorFieldKey> = ["name", "board", "quantity", "information", "grain"];

// A finger, not a mouse: bigger targets.
const subscribeCoarsePointer = (onChange: () => void) => {
  const query = window.matchMedia("(pointer: coarse)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const readCoarsePointer = () => window.matchMedia("(pointer: coarse)").matches;
const useCoarsePointer = () => useSyncExternalStore(subscribeCoarsePointer, readCoarsePointer, () => false);

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

// Where the next point of a drawing goes when its length is typed: exactly that far from the last point, towards
// `toward` (the pointer) — to the nearest 45° with snap on. Nothing to aim it by (no pointer, or one on the last point):
// the way `onward` goes. Landing on the first point (three or more down), it closes the outline. (As snapCustomPoint
// says where a click goes.)
function typedLengthSnap(points: ShapePoint[], toward: ShapePoint | null, length: number, snap: boolean, onward: ShapePoint): CustomSnap {
  const last = points[points.length - 1] ?? [0, 0];
  const aim = toward ? v.sub(toward, last) : null;
  const way = aim && Math.hypot(aim[0], aim[1]) > 1e-9 ? aim : onward;
  const step = Math.PI / 4;
  const angle = snap ? Math.round(Math.atan2(way[1], way[0]) / step) * step : Math.atan2(way[1], way[0]);
  // (A level or upright line exactly so — no float noise across it.)
  const clean = (n: number) => (Math.abs(n) < 1e-12 ? 0 : n);
  const fine = (n: number) => Math.round(n * 1000) / 1000;
  const point: ShapePoint = [fine(last[0] + clean(Math.cos(angle)) * length), fine(last[1] + clean(Math.sin(angle)) * length)];
  const closes = points.length >= 3 && distanceBetween(point, points[0]) < 0.5;
  const degrees = (-Math.atan2(point[1] - last[1], point[0] - last[0]) * 180) / Math.PI;
  return {
    point: closes ? [points[0][0], points[0][1]] : point,
    closes,
    snappedTo: closes ? 0 : null,
    guide: null,
    length,
    angle: (((Math.round(degrees * 10) / 10) % 360) + 360) % 360,
  };
}

// How far a point is from a segment.
function distanceToSegment(point: ShapePoint, a: ShapePoint, b: ShapePoint): number {
  const e = v.sub(b, a);
  const t = Math.min(1, Math.max(0, v.dot(v.sub(point, a), e) / Math.max(v.dot(e, e), 1e-12)));
  return distanceBetween(point, v.add(a, v.mul(e, t)));
}

// A typed length as it's kept: digits and one decimal point (a comma's one too), no longer than it could need.
function cleanLengthText(text: string): string {
  const [whole, ...rest] = String(text).replace(/,/g, ".").replace(/[^\d.]/g, "").split(".");
  return (rest.length ? `${whole}.${rest.join("")}` : whole).slice(0, 8);
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

// Its row's fields it sets besides the shape (its Height × Width × Depth and its clashing come from the shape).
export type CutlistShapeEditorFieldKey = "name" | "board" | "quantity" | "information" | "grain";
// Which way its grain runs: along its Height, its Width, or (a cabinet) its Depth — "" not set.
export type CutlistShapeGrainAxis = "H" | "W" | "D" | "";
export type CutlistShapeEditorFields = {
  name: string;
  board: string;
  quantity: string;
  information: string;
  grain: CutlistShapeGrainAxis;
};
// A board it can be cut from, as its cutlist's Board cell shows it (its sheet's length in metres, `sheet`, then its
// name); its thickness (mm — the 3D slab's, and what a cabinet's parts are worked out at); whether it has a grain.
export type CutlistShapeEditorBoardOption = { value: string; label: string; sheet?: string; thicknessMm: number; grained: boolean };

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
  // Its row's fields as it opens (a new piece: the row it'd be added as).
  fields: CutlistShapeEditorFields;
  // Which of them are shown: those whose column is on in its cutlist (Company Settings › Production › Cutlist columns)
  // — Grain only while its board has a grain. The rest are kept as they are. Default: all of them.
  visibleFields?: ReadonlyArray<CutlistShapeEditorFieldKey>;
  // Its cutlist's boards. (Its board's thickness without them, or not one of them: 18mm.)
  boardOptions?: CutlistShapeEditorBoardOption[];
  // Its Board field — the cutlist rows' own board dropdown, given its value and what a pick does. Not given: a glass
  // dropdown of boardOptions.
  renderBoardPicker?: (picker: { value: string; disabled: boolean; onChange: (value: string) => void }) => ReactNode;
  // A row already in the list: its Part name, Board and Quantity can't be left empty (as the list's own cells can't).
  requireFields?: boolean;
  // What it can be — the company's part types that aren't Custom (their category: "cabinetry", "panel"...; their
  // colour). Given, it's chosen in the panel ("What is it?") and kept in shape.base: a Cabinetry one is a custom
  // cabinet. Not given: a flat piece, as it always was.
  baseOptions?: Array<{ partType: string; category: string; color?: string }>;
  // How tall it is when it's first made a cabinet (mm) — the project's Base Cab Height. Default: 720.
  defaultCabinetHeightMm?: number;
  // What's added to each end of every length of edge banding (mm — Company Settings › Machining's Excess per end), as
  // the cutlists' edge tape totals add it: its Clashing figure counts it too.
  bandingExcessPerEndMm?: number;
  // The gap between two of a cabinet's doors where they meet (mm — the project's Vertical gap between doors / panels: a
  // base cabinet's, `tallDoorGapMm` a tall one's — 1400 or more high).
  doorGapMm?: number;
  tallDoorGapMm?: number;
  // Adding a piece (Save adds a row) rather than changing one.
  isNew?: boolean;
  origin?: GlassModalOrigin;
  originElRef?: RefObject<HTMLElement | null>;
  onSave: (shape: CutlistShape, fields: CutlistShapeEditorFields) => void;
  onClose: () => void;
};

// The pop-up: grows out of what opened it (useGlassModalPopOrigin); the whole screen on a phone (globals.css).
// The Cabinet parts list open or shut — for the session: kept here, and in sessionStorage where it can be (a private
// window or blocked storage just has it shut on a reload).
const CABINET_PARTS_OPEN_KEY = "cutsmart.shapeEditor.cabinetPartsOpen";
let cabinetPartsOpenNow: boolean | null = null;
function readCabinetPartsOpen(): boolean {
  if (cabinetPartsOpenNow !== null) return cabinetPartsOpenNow;
  try {
    cabinetPartsOpenNow = typeof window !== "undefined" && window.sessionStorage.getItem(CABINET_PARTS_OPEN_KEY) === "1";
  } catch {
    cabinetPartsOpenNow = false;
  }
  return cabinetPartsOpenNow;
}
function rememberCabinetPartsOpen(open: boolean) {
  cabinetPartsOpenNow = open;
  try {
    window.sessionStorage.setItem(CABINET_PARTS_OPEN_KEY, open ? "1" : "0");
  } catch {
    // (Not kept past a reload, then.)
  }
}

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

// A shape type as it was left (for going back to it).
type KindState = { shape: CutlistShape; closed: boolean };
// The drawing at a step (Undo and Redo): its shape, closed or not, the lines drawn on it, what it is and a cabinet's own.
type ShapeState = { shape: CutlistShape; closed: boolean; guides: GuideLine[]; base: CutlistShapeBase | null; cabinet: CabinetSettings };
// The tools: Select (what a click does), Line (a drawing's lines, or lines on a finished shape), Measure.
type EditorTool = "select" | "line" | "measure";
type EditorLabel = ShapeLabelRequest & { text: string; value: number; editable: boolean; title: string; live?: boolean };
// A Custom outline's segment being bowed by its handle: which, the pointer, where it went down (client px), whether it's
// moved far enough to be a drag, and its bulge so far.
type CurveDrag = { index: number; pointerId: number; start: ShapePoint; moved: boolean; bulge: number };
// What an edge's menu is for: an edge of the outline (and where on it it was right-clicked, mm), or a construction line.
type EdgeTarget = { edge: number | null; guide: number | null; at: ShapePoint | null };
// An edge's menu, open — and where (client px).
type EdgeMenu = EdgeTarget & { x: number; y: number };
// A finger held on an edge or a construction line (a long press opens its menu): its pointer, where it went down, its
// timer.
type EdgeHold = { pointerId: number; x: number; y: number; timer: number };
// A line drawn on the shape (Add line): one straight piece, from a point to a point (mm). The editor's own — never saved.
type GuideLine = { id: number; a: ShapePoint; b: ShapePoint };

// What's been done in the editor, as one string — compared with how it was opened, to know if there's anything to lose.
function editorStateKey(shape: CutlistShape, base: CutlistShapeBase | null, cabinet: CabinetSettings, fields: CutlistShapeEditorFields, closed: boolean): string {
  return JSON.stringify([cutlistShapeForStorage(shape), base, cabinet, fields, closed]);
}
// ...and just its drawing — its outline, corners, curves, banding and edges' roles, and the lines drawn on it.
function drawingStateKey(shape: CutlistShape, closed: boolean, guides: GuideLine[]): string {
  return JSON.stringify([cutlistShapeForStorage(shape), closed, guides.map((guide) => [guide.a, guide.b])]);
}

function ShapeEditorBody({
  shape: openedShape,
  partType,
  room,
  color,
  readOnly = false,
  fields: openedFields,
  visibleFields = ALL_FIELDS,
  boardOptions,
  renderBoardPicker,
  requireFields = false,
  baseOptions,
  defaultCabinetHeightMm,
  bandingExcessPerEndMm = 0,
  doorGapMm = 0,
  tallDoorGapMm,
  isNew = false,
  onSave,
  onClose,
}: CutlistShapeEditorProps) {
  const coarse = useCoarsePointer();
  const offerUndo = useUndo();
  const [shape, setShape] = useState<CutlistShape>(() => openedShape ?? createTemplateShape("L"));
  // What it is (shape.base), and a cabinet's height and shelves — kept apart from the drawing, so they stay as they are
  // whatever's undone or whichever shape it's switched to. (Its edges' roles and through backs are the drawing's: they
  // go with its edges, in `shape`.) Made a cabinet for the first time, it's the project's Base Cab Height tall.
  const [base, setBase] = useState<CutlistShapeBase | null>(() => openedShape?.base ?? null);
  const [cabinet, setCabinet] = useState<CabinetSettings>(() => {
    const settings = cabinetSettings(openedShape ?? createTemplateShape("L"));
    if (Number(openedShape?.cabinet?.height) > 0) return settings;
    const start = Number(defaultCabinetHeightMm);
    return { ...settings, height: Number.isFinite(start) && start > 0 ? Math.min(4000, start) : DEFAULT_CABINET_HEIGHT };
  });
  // Its row's fields (Part name, Board, Quantity, Information, Grain), as they're set here.
  const [fields, setFields] = useState<CutlistShapeEditorFields>(() => ({ ...openedFields }));
  // The cabinet's height being typed (null: not).
  const [heightText, setHeightText] = useState<string | null>(null);
  // The length being typed for the line being drawn (null: none — it goes where the pointer is).
  const [lengthText, setLengthText] = useState<string | null>(null);
  // An edge's menu (a cabinet's edge's role; Delete line).
  const [edgeMenu, setEdgeMenu] = useState<EdgeMenu | null>(null);
  // Construction lines drawn across the shape; Add line pressed, and the first end of the one being drawn.
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [lineMode, setLineMode] = useState(false);
  const [lineStart, setLineStart] = useState<ShapePoint | null>(null);
  // A cabinet's edge under the pointer, and a part hovered in its parts list.
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [hoverPart, setHoverPart] = useState<string | null>(null);
  // The Cabinet parts list: shut till it's opened (and as it was left, for the rest of the session).
  const [partsOpen, setPartsOpen] = useState(readCabinetPartsOpen);
  const togglePartsOpen = () => {
    const open = !partsOpen;
    setPartsOpen(open);
    // (Shut: nothing in it can be pointed at, so nothing's picked out on the drawing.)
    if (!open) setHoverPart(null);
    rememberCabinetPartsOpen(open);
  };
  // With lines drawn: where on the outline the pointer is (mm), the line under it (and where on it), and Delete line
  // pointed at in a menu — what's picked out is just the piece between crossings, and what Delete line would cut away.
  const [hoverAt, setHoverAt] = useState<ShapePoint | null>(null);
  const [hoverGuide, setHoverGuide] = useState<{ id: number; at: ShapePoint } | null>(null);
  const [deleteHover, setDeleteHover] = useState(false);
  // A Custom outline being drawn isn't closed yet (a template, or one opened, always is).
  const [closed, setClosed] = useState(true);
  // Each shape type as it was left, for going back to it.
  const [byKind, setByKind] = useState<Partial<Record<CutlistShapeKind, KindState>>>({});
  // A Custom outline's steps back (Undo).
  const [history, setHistory] = useState<ShapeState[]>([]);
  // ...and its steps forward again (Redo) — let go once something else is done.
  const [future, setFuture] = useState<ShapeState[]>([]);
  // The template it was before a run of turns and flips (it goes back to it when they bring it back) — let go at any
  // other change.
  const [templateOrigin, setTemplateOrigin] = useState<CutlistShapeTemplateKind | null>(null);
  // Measure: on, and the measurement — its points so far (two: a length; three: an angle, at the middle one), and
  // whether it's finished (no more points to it). Never saved.
  const [measureOn, setMeasureOn] = useState(false);
  const [measure, setMeasure] = useState<{ points: ShapePoint[]; done: boolean } | null>(null);
  // The grid behind the drawing, and its numbers (always on an export and on paper).
  const [gridOn, setGridOn] = useState(true);
  const [dimsOn, setDimsOn] = useState(true);
  // The keys' list, open.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [snapOn, setSnapOn] = useState(true);
  // How it was opened (its drawing, what it is, a cabinet's own, its fields) — anything else, and closing it asks first
  // (Are you sure? — its X, Escape, a swipe down).
  const [openedKey] = useState(() => editorStateKey(shape, base, cabinet, fields, closed));
  const [confirmClose, setConfirmClose] = useState(false);
  // (Clear asks first — Clear the drawing? — once the drawing's not as it was opened.)
  const [openedDrawingKey] = useState(() => drawingStateKey(shape, closed, []));
  const [confirmClear, setConfirmClear] = useState(false);
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [size, setSize] = useState({ width: 0, height: 0 });
  // The drawing's scale (px per mm) — null: fitted to the view. Kept while sizes change, so the drawing grows and shrinks.
  const [scale, setScale] = useState<number | null>(null);
  // Where mm 0, 0 is on the view — null: the shape centred (a template always is; a Custom outline stays put).
  const [pan, setPan] = useState<{ ox: number; oy: number } | null>(null);
  // The view zoomed or moved by hand (the wheel, a pinch, − / +, a drag): changes to the shape leave it where it is,
  // till Fit (or a new shape type, or a resize) fits it again.
  const [viewSet, setViewSet] = useState(false);
  // The 3D view's turn (kept here: its export draws it as it's seen); a turn carried on into it from a right-drag on the
  // 2D drawing; the face under the pointer there. And the 2D drawing being moved (the closed hand shows).
  const [view3d, setView3d] = useState<CabinetView>(CABINET_3D_DEFAULT_VIEW);
  const [turnStart, setTurnStart] = useState<View3dTurnStart | null>(null);
  const [hover3d, setHover3d] = useState<Cabinet3dFace | null>(null);
  // A cabinet's roles shown in 3D (its Labels switch — its export the same).
  const [rolesShown, setRolesShown] = useState(readCabinetRolesShown);
  const [panning, setPanning] = useState(false);
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
  // The typed length's box, and a finger held on a cabinet's edge (the click its long press ends in isn't a tap too).
  const lengthInputRef = useRef<HTMLInputElement | null>(null);
  const statusAtRef = useRef<HTMLSpanElement | null>(null);
  const edgeHoldRef = useRef<EdgeHold | null>(null);
  const holdOpenedMenuRef = useRef(false);
  // The view being moved: a drag on the drawing's empty space (or the middle button anywhere); the fingers on it (two:
  // a pinch — zoomed and moved with them, and nothing else that press does is done).
  const panDragRef = useRef<{ pointerId: number; x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const touchesRef = useRef(new Map<number, ShapePoint>());
  const pinchRef = useRef<{ dist: number; mid: ShapePoint; s: number; ox: number; oy: number } | null>(null);
  const pinchedRef = useRef(false);
  // (A right-button press on the 2D drawing: dragged a few px, it's 3D, turning from there.)
  const rightDragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  useEffect(
    () => () => {
      if (edgeHoldRef.current) window.clearTimeout(edgeHoldRef.current.timer);
    },
    [],
  );

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const say = (text: string) => setNotice((prev) => ({ text, id: (prev?.id ?? 0) + 1 }));
  const refuseCrossing = () => say(CROSSING_MESSAGE);

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
      setViewSet(false);
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
  // A Custom outline's cut-outs, placed off the box round it (shapeCutoutDimensions) — and the segments whose length
  // they already say.
  const cutouts = useMemo(() => (shown.kind === "custom" && live ? shapeCutoutDimensions(shown) : null), [live, shown]);
  // An outline that crosses itself can't be cut: the curve being dragged (let go there, it isn't kept), or the shape
  // itself (one saved so before this was checked) — Save is off till it's put right.
  const dragCrosses = useMemo(() => Boolean(curveDrag?.moved) && shapeSelfIntersects(shown), [curveDrag, shown]);
  const crosses = useMemo(() => isCustom && closed && shapeSelfIntersects(shape), [closed, isCustom, shape]);
  const message = dragCrosses || crosses ? CROSSING_MESSAGE : (notice?.text ?? "");
  useEffect(() => {
    holdViewRef.current = drawing && points.length > 0;
  });

  // ---- Its board, as chosen: its thickness (the 3D slab's; a cabinet's parts are worked out at it) and its grain.
  const boardOption = boardOptions?.find((option) => option.value === fields.board);
  const boardMm = Math.max(0, Number(boardOption?.thicknessMm) || 18);
  const grained = Boolean(boardOption?.grained);
  const shows = (key: CutlistShapeEditorFieldKey) => visibleFields.includes(key);

  // ---- A cabinet (what it is: one of the company's Cabinetry part types): the drawing is its top view. Its edges'
  // roles, where its backs meet, what it's made of and its 3D model — all from the shape as shown (a curve being
  // dragged, as it would be), at the cabinet's board thickness.
  const cabinetMode = Boolean(baseOptions?.length) && Boolean(base) && isCabinetShape(base ? { ...shape, base } : null);
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
  // (Its doors the project's gap apart where they meet — a tall cabinet's gap if it's one.)
  const cabinetDoorGap = cabinet.height >= 1400 && tallDoorGapMm !== undefined ? tallDoorGapMm : doorGapMm;
  const model = useMemo(
    () => (cabinetLive ? customCabinetModel(cabinetLive, { thicknessMm: boardMm, doorGapMm: cabinetDoorGap }) : null),
    [boardMm, cabinetDoorGap, cabinetLive],
  );
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

  // ---- Zoom: about a point on the view (px) — the wheel's pointer, a pinch's fingers, the middle for − / + — between a
  // fifth of fitted and fifty times it. The numbers and handles stay their size; only the drawing grows.
  const clampScale = (value: number) => Math.min(fitScale * 50, Math.max(fitScale * 0.2, value));
  const zoomAt = (x: number, y: number, factor: number) => {
    if (size.width <= 0 || !(factor > 0)) return;
    const next = clampScale(s * factor);
    const k = next / s;
    setScale(next);
    setPan({ ox: x - (x - origin.ox) * k, oy: y - (y - origin.oy) * k });
    setViewSet(true);
  };
  const fitView = () => {
    setScale(null);
    setPan(null);
    setViewSet(false);
  };
  const stagePoint = (clientX: number, clientY: number): ShapePoint => {
    const box = stageRef.current?.getBoundingClientRect();
    return box ? [clientX - box.left, clientY - box.top] : [clientX, clientY];
  };
  // The wheel (a trackpad's pinch comes as one with Ctrl): zoomed about the pointer. (Heard as the browser's own — not
  // passive — so the page doesn't zoom or scroll too.)
  const onStageWheel = useEffectEvent((event: WheelEvent) => {
    if (view !== "2d") return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height || 400 : 1;
    const [x, y] = stagePoint(event.clientX, event.clientY);
    zoomAt(x, y, Math.exp(-event.deltaY * unit * (event.ctrlKey ? 0.01 : 0.002)));
  });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const handler = (event: WheelEvent) => onStageWheel(event);
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);
  // A drag on the drawing's empty space — or with the middle button anywhere — moves it.
  const startPan = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 1) return;
    if (event.button === 1) event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ox: origin.ox, oy: origin.oy, moved: false };
  };
  // (Each says whether the pointer was moving the view — so a drawing's press doesn't put a point down too.)
  const movePan = (event: ReactPointerEvent<SVGRectElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    if (pinchRef.current) return true;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_START_PX) return true;
    if (!drag.moved) {
      drag.moved = true;
      setScale(s);
      setViewSet(true);
      setPanning(true);
    }
    setPan({ ox: drag.ox + dx, oy: drag.oy + dy });
    return true;
  };
  const endPan = (event: ReactPointerEvent<SVGRectElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    panDragRef.current = null;
    setPanning(false);
    return true;
  };
  // Two fingers on the drawing: a pinch — zoomed about them, and moved as they move. (Heard before anything under them,
  // so whatever the first finger had started — a line, a curve, a long press — is let go.)
  const onStageTouchDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      rightDragRef.current = event.button === 2 && view === "2d" && live ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY } : null;
      return;
    }
    if (event.pointerType !== "touch") return;
    const touches = touchesRef.current;
    if (!touches.size) pinchedRef.current = false;
    touches.set(event.pointerId, stagePoint(event.clientX, event.clientY));
    if (touches.size !== 2 || view !== "2d") return;
    const [a, b] = [...touches.values()];
    pinchRef.current = { dist: Math.max(1, distanceBetween(a, b)), mid: v.mid(a, b), s, ox: origin.ox, oy: origin.oy };
    pinchedRef.current = true;
    panDragRef.current = null;
    endEdgeHold();
    setCurveDrag(null);
    setPointer(null);
  };
  const onStageTouchMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    // (A right-drag: a few px, and it's 3D — turned on from there by the same drag. Not dragged: an edge's menu, as ever.)
    const right = rightDragRef.current;
    if (right && right.pointerId === event.pointerId) {
      if (!(event.buttons & 2)) rightDragRef.current = null;
      else if (Math.hypot(event.clientX - right.x, event.clientY - right.y) >= RIGHT_DRAG_PX) {
        rightDragRef.current = null;
        changeView("3d", { pointerId: event.pointerId, x: event.clientX, y: event.clientY });
      }
      return;
    }
    const touches = touchesRef.current;
    if (event.pointerType !== "touch" || !touches.has(event.pointerId)) return;
    touches.set(event.pointerId, stagePoint(event.clientX, event.clientY));
    const pinch = pinchRef.current;
    if (!pinch || touches.size < 2) return;
    const [a, b] = [...touches.values()];
    const mid = v.mid(a, b);
    const next = clampScale(pinch.s * (distanceBetween(a, b) / pinch.dist));
    const k = next / pinch.s;
    setScale(next);
    setPan({ ox: mid[0] - (pinch.mid[0] - pinch.ox) * k, oy: mid[1] - (pinch.mid[1] - pinch.oy) * k });
    setViewSet(true);
  };
  const onStageTouchUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (rightDragRef.current?.pointerId === event.pointerId) rightDragRef.current = null;
    if (event.pointerType !== "touch") return;
    touchesRef.current.delete(event.pointerId);
    if (touchesRef.current.size < 2) pinchRef.current = null;
  };

  // ---- Changes.
  // A change to the shape: the scale kept (so it visibly grows or shrinks), unless it no longer fits — then fitted again.
  // A template's re-centred; a Custom outline stays where it is (and the change can be undone).
  const commitShape = (next: CutlistShape) => {
    const keep = scale ?? fitScale;
    const b = shapeBounds(next);
    // (Overflowing: no longer room round it for its numbers.)
    const room = pad * 0.7;
    const tooBig = b.width * keep + 2 * room > size.width || b.height * keep + 2 * room > size.height;
    record();
    // (Zoomed or moved by hand: the view stays as it was put.)
    if (viewSet) {
      setShape(next);
      return;
    }
    if (isCustom) {
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
    record();
    setShape(kept?.shape ?? (kind === "custom" ? createCustomShape() : createTemplateShape(kind)));
    setClosed(kept?.closed ?? kind !== "custom");
    fitView();
    setPointer(null);
    setHoverRun(null);
    setHoverEdge(null);
    setEditing(null);
    setCurveDrag(null);
    setNotice(null);
    setLengthText(null);
    setEdgeMenu(null);
    setGuides([]);
    setLineMode(false);
    setLineStart(null);
  };

  // Undo and Redo: every change to the drawing a step — a size typed, a radius, a curve, its banding, a cabinet's roles,
  // a cut, a line drawn, a turn or a flip, what it is, a cabinet's height and shelves, Clear — taken back, or done again.
  const current = (): ShapeState => ({ shape, closed, guides, base, cabinet });
  const record = () => {
    setHistory((prev) => [...prev.slice(-99), current()]);
    setFuture([]);
    setTemplateOrigin(null);
  };
  const pushHistory = record;
  const restore = (state: ShapeState) => {
    if (state.shape.kind !== shape.kind || state.closed !== closed) fitView();
    setShape(state.shape);
    setClosed(state.closed);
    setGuides(state.guides);
    setBase(state.base);
    setCabinet(state.cabinet);
    setEditing(null);
    setHoverRun(null);
    setHoverEdge(null);
    setLengthText(null);
    setEdgeMenu(null);
    setLineStart(null);
  };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last || readOnly) return;
    setHistory((prev) => prev.slice(0, -1));
    setFuture((prev) => [...prev, current()]);
    restore(last);
  };
  const redo = () => {
    const next = future[future.length - 1];
    if (!next || readOnly) return;
    setFuture((prev) => prev.slice(0, -1));
    setHistory((prev) => [...prev.slice(-99), current()]);
    restore(next);
  };
  // Rotate 90° and the flips: the shape turned or mirrored, everything on it with it (lib/cutlist-shape.ts's
  // transformShape) — the lines drawn on it too — fitted to the view again.
  const transformBy = (how: ShapeTransform) => {
    if (readOnly || !live || drawing) return;
    // (A template turned or flipped into a Custom outline goes back to it when it's turned back to match — kept till
    // anything else is done. A drawn Custom outline stays Custom.)
    const backTo = isTemplateShapeKind(shape.kind) ? shape.kind : templateOrigin;
    const { shape: next, mapPoint } = transformShape(cabinetMode && cabShape ? cabShape : shape, how, { backTo });
    record();
    setTemplateOrigin(backTo);
    setShape(next);
    setGuides((prev) => prev.map((guide) => ({ ...guide, a: mapPoint(guide.a), b: mapPoint(guide.b) })));
    setMeasure(null);
    setEditing(null);
    setHoverRun(null);
    setHoverEdge(null);
    setEdgeMenu(null);
    fitView();
  };
  // Clear: the drawing gone (an Undo step) — and the Undo bar along the bottom, to put it back as it was: its outline,
  // corners, curves, banding and edges' roles, and the lines drawn on it. Changed from how it was opened, it's asked
  // first (Clear the drawing?).
  const requestClear = () => {
    if (!points.length) return;
    if (drawingStateKey(shape, closed, guides) === openedDrawingKey) clearDrawing();
    else setConfirmClear(true);
  };
  const clearDrawing = () => {
    if (!points.length) return;
    const before = { shape, closed, guides };
    pushHistory();
    setShape(createCustomShape());
    setClosed(false);
    fitView();
    setEditing(null);
    setLengthText(null);
    setGuides([]);
    offerUndo("Drawing cleared", () => {
      setShape(before.shape);
      setClosed(before.closed);
      setGuides(before.guides);
      setLengthText(null);
      fitView();
    });
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
    setLengthText(null);
    // (Where it is now — closing it doesn't move it.)
    setScale(s);
    setPan(origin);
  };
  // The next point down — where a click snaps to, or at a typed length — or, on the first point, the outline closed.
  // (A typed length is let go once its point's down; kept, to aim again, if the point isn't taken.)
  const addPoint = (next: Pick<CustomSnap, "point" | "closes">) => {
    if (next.closes) {
      closeOutline();
      return;
    }
    const last = points[points.length - 1];
    if (last && distanceBetween(last, next.point) < 0.5) return;
    const nextPoints = [...points, next.point];
    // (Its line from the last point mustn't cross — or touch — one already drawn.)
    if (customOutlineSelfIntersects(nextPoints, shapeBulges(shape), false)) {
      refuseCrossing();
      return;
    }
    pushHistory();
    setLengthText(null);
    // (The view held still from the first point on — the drawing doesn't move under the pointer. A typed length that
    // goes off the view: fitted again, so it shows.)
    const at = toScreen(next.point);
    if (!points.length) {
      setScale(s);
      setPan(origin);
    } else if (at[0] < 0 || at[1] < 0 || at[0] > size.width || at[1] > size.height) {
      fitView();
    }
    // (The new line starts straight — any curve kept for a segment from the last point on is let go.)
    let shaped: CutlistShape = { ...shape, points: nextPoints };
    for (const key of Object.keys(shapeBulges(shaped)).map(Number)) {
      if (key >= points.length - 1) shaped = setCustomSegmentBulge(shaped, key, 0);
    }
    setShape(shaped);
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
    record();
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
  // An edge's menu (right-click it, or press and hold): a cabinet's edge made doors, a back or an end — and a back
  // meeting another back, the one that runs through at those corners (each one it meets; again, the other back does);
  // with construction lines drawn, Delete line — the piece of the outline it's on cut away up to the nearest line. A
  // construction line's own menu: Delete line, the line itself gone. (Nothing to offer: no menu.)
  const openEdgeMenu = (target: EdgeTarget, x: number, y: number) => {
    if (readOnly || !live) return;
    if (target.guide === null && !(cabinetMode && cabShape) && !guides.length) return;
    setEdgeMenu((prev) => (prev && prev.edge === target.edge && prev.guide === target.guide ? prev : { ...target, x, y }));
    setDeleteHover(false);
    if (cabinetMode && target.edge !== null) setHoverEdge(target.edge);
  };
  // The outline's corner points (a template's too) — what a construction line meets, and what's cut along it.
  const outlineVertices = live ? shapeVertices(shape) : [];
  // The outline's edge nearest a point (mm).
  const nearestEdge = (at: ShapePoint) => {
    let best = 0;
    let bestDistance = Infinity;
    outlineVertices.forEach((p, i) => {
      const q = outlineVertices[(i + 1) % outlineVertices.length];
      const e = v.sub(q, p);
      const t = Math.min(1, Math.max(0, v.dot(v.sub(at, p), e) / Math.max(v.dot(e, e), 1e-12)));
      const d = distanceBetween(at, v.add(p, v.mul(e, t)));
      if (d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    return best;
  };
  // The piece of the outline under the pointer (an event on the drawing): its edge — given, or the nearest — and where
  // it is.
  const pieceAt = (event: { clientX: number; clientY: number; currentTarget: SVGGElement }, edge?: number): EdgeTarget & { at: ShapePoint } => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    const at = toMm(event.clientX - (box?.left ?? 0), event.clientY - (box?.top ?? 0));
    return { edge: edge ?? nearestEdge(at), guide: null, at };
  };
  // Delete line on a piece of the outline: the region inside it — closed off by the lines drawn — cut away, the outline
  // what's round the rest (lib/cutlist-shape.ts's cutShapeFace; refused, with a word why). The lines used go; the rest
  // stay. A template's a Custom outline from then on; Undo takes it back.
  const cutLines: ShapeCutLine[] = guides.map((guide) => ({ a: guide.a, b: guide.b }));
  const withNewIds = (lines: ShapeCutLine[]): GuideLine[] => {
    const first = guides.reduce((top, guide) => Math.max(top, guide.id), 0) + 1;
    return lines.map((line, i) => ({ id: first + i, a: line.a, b: line.b }));
  };
  const deleteLinePiece = (edgeIndex: number, at: ShapePoint) => {
    setEdgeMenu(null);
    if (readOnly || !live) return;
    const source = cabinetMode && cabShape ? cabShape : shape;
    const result = cutShapeFace(source, cutLines, { edge: edgeIndex, at }, cabinetMode ? { edgeRoles: roles } : {});
    if (!result.ok) {
      say(
        result.reason === "curve"
          ? "A line can't cut through a curve"
          : result.reason === "split"
            ? "That would leave it in two pieces"
            : result.reason === "hole"
              ? "That would leave a hole — a piece can't have one"
              : result.reason === "invalid"
                ? CROSSING_MESSAGE
                : "No line cuts this piece off",
      );
      return;
    }
    record();
    // (Where it is now — cutting it doesn't move it.)
    setScale(s);
    setPan(origin);
    setShape(result.shape);
    setClosed(true);
    setGuides(withNewIds(result.lines));
    setHoverRun(null);
    setHoverEdge(null);
    setEditing(null);
  };
  // Delete line on a line drawn: just that piece of it, from crossing to crossing (cutShapeLinePiece).
  const deleteGuidePiece = (id: number, at: ShapePoint | null) => {
    setEdgeMenu(null);
    const index = guides.findIndex((guide) => guide.id === id);
    if (index < 0) return;
    const guide = guides[index];
    record();
    setGuides(withNewIds(cutShapeLinePiece(shape, cutLines, index, at ?? v.mid(guide.a, guide.b))));
  };
  const pickEdgeRole = (edgeIndex: number, role: CabinetEdgeRole) => {
    setEdgeMenu(null);
    if (readOnly || !cabShape || roles[edgeIndex] === role) return;
    commitShape(setCabinetEdgeRole(cabShape, edgeIndex, role));
  };
  const backMeetings = (edgeIndex: number) => backCorners.filter((meeting) => meeting.incoming === edgeIndex || meeting.outgoing === edgeIndex);
  const runBackThrough = (edgeIndex: number) => {
    setEdgeMenu(null);
    if (readOnly || !cabShape) return;
    const meetings = backMeetings(edgeIndex);
    if (!meetings.length) return;
    const throughAll = meetings.every((meeting) => meeting.through === edgeIndex);
    let next = cabShape;
    for (const meeting of meetings) if (throughAll || meeting.through !== edgeIndex) next = toggleCabinetThroughBack(next, meeting.corner);
    commitShape(next);
  };
  // A finger held still on an edge: its menu, where it's held. (Moved, lifted or let go first: an ordinary tap or drag.)
  const endEdgeHold = () => {
    if (!edgeHoldRef.current) return;
    window.clearTimeout(edgeHoldRef.current.timer);
    edgeHoldRef.current = null;
  };
  const startEdgeHold = (target: EdgeTarget, event: ReactPointerEvent<SVGGElement>) => {
    endEdgeHold();
    holdOpenedMenuRef.current = false;
    if (readOnly || event.pointerType === "mouse") return;
    const { clientX: x, clientY: y, pointerId } = event;
    const timer = window.setTimeout(() => {
      edgeHoldRef.current = null;
      holdOpenedMenuRef.current = true;
      openEdgeMenu(target, x, y);
    }, HOLD_MS);
    edgeHoldRef.current = { pointerId, x, y, timer };
  };
  // An edge's or a construction line's right-click, and its long press: its menu.
  const menuHandlers = (
    target: (event: { clientX: number; clientY: number; currentTarget: SVGGElement }) => EdgeTarget,
    onMove?: (event: ReactPointerEvent<SVGGElement>) => void,
  ) => ({
    onPointerDown: (event: ReactPointerEvent<SVGGElement>) => startEdgeHold(target(event), event),
    onPointerMove: (event: ReactPointerEvent<SVGGElement>) => {
      moveEdgeHold(event);
      onMove?.(event);
    },
    onPointerUp: endEdgeHold,
    onPointerCancel: endEdgeHold,
    onContextMenu: (event: ReactMouseEvent<SVGGElement>) => {
      event.preventDefault();
      event.stopPropagation();
      endEdgeHold();
      openEdgeMenu(target(event), event.clientX, event.clientY);
    },
  });
  const trackHoverAt = (event: ReactPointerEvent<SVGGElement>) => {
    if (guides.length) setHoverAt(pieceAt(event).at);
  };
  // (The tap a long press ends in: its menu's open instead.)
  const tapAfterHold = () => {
    if (!holdOpenedMenuRef.current) return false;
    holdOpenedMenuRef.current = false;
    return true;
  };
  const moveEdgeHold = (event: ReactPointerEvent<SVGGElement>) => {
    const hold = edgeHoldRef.current;
    if (hold && hold.pointerId === event.pointerId && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > HOLD_SLOP_PX) endEdgeHold();
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
    if (height === cabinet.height) return;
    record();
    setCabinet((prev) => ({ ...prev, height }));
  };
  const stepShelves = (key: "fixedShelves" | "adjustableShelves", by: number) => {
    if (readOnly) return;
    record();
    setCabinet((prev) => ({ ...prev, [key]: Math.min(20, Math.max(0, prev[key] + by)) }));
  };

  // ---- Add line (pressed: on till it's pressed again, or Escape): lines drawn on the shape, one after another — each
  // from where the last ended, as a Custom outline's are — starting on the outline or a line already drawn, the run of
  // them ending where one lands on the outline or another line (or with a double-click, Enter, or a right-click on
  // empty space). Solid, in the brand blue till they're used: Delete line on a piece of the outline cuts away the region
  // they close off there. Their ends snap onto the outline's corners and straight edges, the lines' ends and the lines
  // themselves, and where any of them cross; snap on, their direction to 45° too — onto any of those that way, where
  // it's met near the pointer. A length can be typed for one as for a drawing's line.
  const snapSegments: Array<[ShapePoint, ShapePoint]> = [];
  {
    const curved = shapeBulges(shape);
    outlineVertices.forEach((p, i) => {
      if (!curved[i]) snapSegments.push([p, outlineVertices[(i + 1) % outlineVertices.length]]);
    });
    for (const guide of guides) snapSegments.push([guide.a, guide.b]);
  }
  const snapPoints: ShapePoint[] = [...outlineVertices, ...guides.flatMap((guide) => [guide.a, guide.b])];
  if (guides.length) {
    for (let i = 0; i < snapSegments.length; i += 1) {
      for (let j = i + 1; j < snapSegments.length; j += 1) {
        const [p, q] = snapSegments[i];
        const [r, t] = snapSegments[j];
        const d1 = v.sub(q, p);
        const d2 = v.sub(t, r);
        const denom = d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.abs(denom) < 1e-9) continue;
        const w = v.sub(r, p);
        const a = (w[0] * d2[1] - w[1] * d2[0]) / denom;
        const b = (w[0] * d1[1] - w[1] * d1[0]) / denom;
        if (a >= -1e-9 && a <= 1 + 1e-9 && b >= -1e-9 && b <= 1 + 1e-9) snapPoints.push(v.add(p, v.mul(d1, a)));
      }
    }
  }
  const fine = (p: ShapePoint): ShapePoint => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];
  const lineSnap = (raw: ShapePoint): ShapePoint | null => {
    let best: ShapePoint | null = null;
    let bestPx = 12;
    for (const p of snapPoints) {
      const px = distanceBetween(p, raw) * s;
      if (px <= bestPx) {
        bestPx = px;
        best = fine(p);
      }
    }
    if (best) return best;
    bestPx = 10;
    for (const [a, b] of snapSegments) {
      const e = v.sub(b, a);
      const t = Math.min(1, Math.max(0, v.dot(v.sub(raw, a), e) / Math.max(v.dot(e, e), 1e-12)));
      const at = v.add(a, v.mul(e, t));
      const px = distanceBetween(at, raw) * s;
      if (px < bestPx) {
        bestPx = px;
        best = fine(at);
      }
    }
    return best;
  };
  // (On the outline or a line: where a run of lines ends.)
  const onLinework = (p: ShapePoint) => snapSegments.some(([a, b]) => distanceToSegment(p, a, b) <= 0.01);
  const measured = (from: ShapePoint, to: ShapePoint) => {
    const degrees = (-Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
    return { length: distanceBetween(from, to), angle: (((Math.round(degrees * 10) / 10) % 360) + 360) % 360 };
  };
  // Where a line from `from` ends, aimed at `raw`. Snap on, its direction's snapped first (snapCustomPoint — 45°, lined
  // up, 10mm) and it ends where that way meets the outline or a line near the pointer — on a corner, a line's end or a
  // crossing only if one lies that way (within half a mm, or 1.5px); the angle's never let go for an edge. Snap off: onto the
  // nearest point of whatever's under the pointer, as it is.
  const lineEndFor = (from: ShapePoint, raw: ShapePoint): CustomSnap => {
    const aimed = snapCustomPoint([from], raw, { snap: snapOn, mmPerPx: 1 / s });
    if (!snapOn) {
      const onto = lineSnap(raw);
      return onto && distanceBetween(onto, from) > 0.5 ? { ...aimed, ...measured(from, onto), point: onto } : aimed;
    }
    const dir = v.unit(v.sub(aimed.point, from));
    if (!(Math.hypot(dir[0], dir[1]) > 0)) return aimed;
    // (A corner, an end or a crossing that way: it.)
    let best: ShapePoint | null = null;
    let bestPx = 14;
    for (const p of snapPoints) {
      const along = v.dot(v.sub(p, from), dir);
      if (along <= 0.5) continue;
      const offMm = Math.abs((p[0] - from[0]) * dir[1] - (p[1] - from[1]) * dir[0]);
      const px = distanceBetween(p, aimed.point) * s;
      if ((offMm <= 0.5 || offMm * s <= 1.5) && px <= bestPx) {
        bestPx = px;
        best = fine(p);
      }
    }
    if (best) return { ...aimed, ...measured(from, best), point: best };
    // (Else where that way meets an edge or a line.)
    bestPx = 14;
    for (const [p, q] of snapSegments) {
      const e = v.sub(q, p);
      const denom = dir[0] * e[1] - dir[1] * e[0];
      if (Math.abs(denom) < 1e-12) continue;
      const w = v.sub(p, from);
      const u = (w[0] * e[1] - w[1] * e[0]) / denom;
      const t = (w[0] * dir[1] - w[1] * dir[0]) / denom;
      if (u <= 0.5 || t < -1e-9 || t > 1 + 1e-9) continue;
      const at = v.add(from, v.mul(dir, u));
      const px = distanceBetween(at, raw) * s;
      if (px < bestPx) {
        bestPx = px;
        best = fine(at);
      }
    }
    return best ? { ...aimed, ...measured(from, best), point: best } : aimed;
  };
  const lineDrawing = lineMode && Boolean(lineStart) && Boolean(live) && !readOnly && view === "2d";
  // The tool in use: Measure if it's on; else a drawing still open is drawn with Line; else what's picked.
  const activeTool: EditorTool = measureOn ? "measure" : drawing || lineMode ? "line" : "select";
  const pickTool = (next: EditorTool) => {
    if (next === "line" && !drawing && (!live || readOnly || view !== "2d")) return;
    if (next === "measure" && view !== "2d") return;
    // (A drawing still open: its own Line — Add line's only for a finished shape.)
    setLineMode(next === "line" && !drawing);
    setMeasureOn(next === "measure");
    setMeasure(null);
    setLineStart(null);
    setPointer(null);
    setLengthText(null);
    setEditing(null);
    setEdgeMenu(null);
    setHoverRun(null);
    setHoverEdge(null);
  };
  // A line's end down: it's drawn, and the next goes on from it — unless it's landed on the outline or a line.
  const finishLine = (end: ShapePoint) => {
    if (!lineStart || distanceBetween(lineStart, end) < 1) return;
    const from = lineStart;
    const landed = onLinework(end);
    record();
    setGuides((prev) => [...prev, { id: prev.reduce((top, guide) => Math.max(top, guide.id), 0) + 1, a: from, b: end }]);
    setLineStart(landed ? null : end);
    setLengthText(null);
  };
  const endLineRun = () => {
    setLineStart(null);
    setLengthText(null);
  };

  // ---- Drawing a Custom outline (pointer events, so a finger works as a mouse does): the point goes where it's let go.
  // Or a length typed while a line's being drawn — a drawing's next line, or a construction line (its number keys; a
  // touch screen's Length box, tapped): the line stays that long — only its direction follows the pointer, snapped as
  // ever — and Enter, or a click, puts its end there.
  const lastPoint = points[points.length - 1];
  const typingLength = !readOnly && view === "2d" && lengthText !== null && ((drawing && points.length > 0) || lineDrawing);
  const typedMm = typingLength ? Number.parseFloat(String(lengthText)) : Number.NaN;
  // (A typed length with no pointer to aim it: on the way the last line went, else to the right.)
  const runFrom: ShapePoint[] = drawing ? points : lineStart ? [lineStart] : [];
  const onward: ShapePoint = drawing && points.length >= 2 ? v.unit(v.sub(points[points.length - 1], points[points.length - 2])) : [1, 0];
  const typedSnap = typingLength && typedMm > 0 ? typedLengthSnap(runFrom, pointer, typedMm, snapOn, onward) : null;
  const placePoint = (raw: ShapePoint) =>
    addPoint(typedSnap ? typedLengthSnap(points, raw, typedMm, snapOn, onward) : snapCustomPoint(points, raw, { snap: snapOn, mmPerPx: 1 / s }));
  // Enter: its end at the typed length (nothing typed, or 0: the length let go).
  const enterLength = () => {
    if (!typedSnap) setLengthText(null);
    else if (drawing) addPoint(typedSnap);
    else finishLine(typedSnap.point);
  };
  // A line's ends: the first onto the outline or a line; each next where it's aimed (lineEndFor) or typed. A right-click:
  // a run of lines ended — or, none going, the menu of the line or piece of the outline under it.
  const onLinePointerDown = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.pointerType === "mouse" && event.button === 1) {
      startPan(event);
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (lengthInputRef.current && document.activeElement === lengthInputRef.current) lengthInputRef.current.blur();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPointer(localPoint(event));
  };
  const onLinePointerMove = (event: ReactPointerEvent<SVGRectElement>) => {
    if (movePan(event) || pinchRef.current) return;
    setPointer(localPoint(event));
  };
  const onLinePointerUp = (event: ReactPointerEvent<SVGRectElement>) => {
    if (endPan(event)) return;
    const raw = localPoint(event);
    if (event.pointerType !== "mouse") setPointer(null);
    if (pinchedRef.current) return;
    if (!lineStart) {
      const start = lineSnap(raw);
      if (start) setLineStart(start);
      else say("Start the line on the outline or another line");
      return;
    }
    finishLine(typedSnap ? typedLengthSnap([lineStart], raw, typedMm, snapOn, onward).point : lineEndFor(lineStart, raw).point);
  };
  const onLineContextMenu = (event: ReactMouseEvent<SVGRectElement>) => {
    event.preventDefault();
    if (lineStart) {
      endLineRun();
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const at = toMm(event.clientX - box.left, event.clientY - box.top);
    const near = (a: ShapePoint, b: ShapePoint) => distanceToSegment(at, a, b) * s <= 10;
    const guide = guides.find((candidate) => near(candidate.a, candidate.b));
    if (guide) {
      openEdgeMenu({ edge: null, guide: guide.id, at }, event.clientX, event.clientY);
      return;
    }
    const edge = nearestEdge(at);
    if (outlineVertices.length && near(outlineVertices[edge], outlineVertices[(edge + 1) % outlineVertices.length])) {
      openEdgeMenu({ edge, guide: null, at }, event.clientX, event.clientY);
    }
  };
  // Measure: a click a point, another the second — the length between them; a third, the angle at the second (each leg's
  // length too), and it's finished. A right-click finishes it as it is; another clears it. The next click after it's
  // finished starts a new one. Snapped only to what's drawn — corners, points on edges and lines, lines' ends, crossings
  // (lineSnap) — never to an angle or the 10mm steps: anywhere else, exactly where the pointer is. Never saved, never a
  // change.
  const measureAt = (raw: ShapePoint): ShapePoint => lineSnap(raw) ?? fine(raw);
  const measureEnd = (_from: ShapePoint, raw: ShapePoint) => measureAt(raw);
  const onMeasurePointerDown = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.pointerType === "mouse" && event.button === 1) {
      startPan(event);
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPointer(localPoint(event));
  };
  const onMeasurePointerUp = (event: ReactPointerEvent<SVGRectElement>) => {
    if (endPan(event)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const raw = localPoint(event);
    if (event.pointerType !== "mouse") setPointer(null);
    if (pinchedRef.current) return;
    if (!measure || measure.done) {
      setMeasure({ points: [measureAt(raw)], done: false });
      return;
    }
    const last = measure.points[measure.points.length - 1];
    const next = measureEnd(last, raw);
    if (distanceBetween(last, next) < 0.5) return;
    const points = [...measure.points, next];
    setMeasure({ points, done: points.length >= 3 });
  };
  // (A right-click: the measurement finished as it is — then cleared. Never an edge's menu.)
  const onMeasureContextMenu = (event: ReactMouseEvent<SVGRectElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!measure) return;
    if (measure.done || measure.points.length < 2) setMeasure(null);
    else setMeasure({ ...measure, done: true });
  };
  const localPoint = (event: ReactPointerEvent<SVGRectElement>): ShapePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return toMm(event.clientX - rect.left, event.clientY - rect.top);
  };
  const onDrawPointerDown = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.pointerType === "mouse" && event.button === 1) {
      startPan(event);
      return;
    }
    pressEndedEditRef.current = Boolean(editing);
    // (A touch screen's keyboard put away as the line's aimed.)
    if (lengthInputRef.current && document.activeElement === lengthInputRef.current) lengthInputRef.current.blur();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPointer(localPoint(event));
  };
  const onDrawPointerMove = (event: ReactPointerEvent<SVGRectElement>) => {
    if (movePan(event) || pinchRef.current) return;
    setPointer(localPoint(event));
  };
  const onDrawPointerUp = (event: ReactPointerEvent<SVGRectElement>) => {
    if (endPan(event)) return;
    const raw = localPoint(event);
    if (event.pointerType !== "mouse") setPointer(null);
    // (A pinch's fingers: the view was being zoomed, not a point put down.)
    if (pinchedRef.current) return;
    if (pressEndedEditRef.current) {
      pressEndedEditRef.current = false;
      return;
    }
    placePoint(raw);
  };
  const snapped = drawing ? (typedSnap ?? (pointer && !readOnly ? snapCustomPoint(points, pointer, { snap: snapOn, mmPerPx: 1 / s }) : null)) : null;
  // The line being drawn's end as it's aimed — and, none started, where one would start.
  const lineNext = lineDrawing && lineStart ? (typedSnap ?? (pointer ? lineEndFor(lineStart, pointer) : null)) : null;
  const lineStartAt = lineMode && !lineStart && pointer && live ? lineSnap(pointer) : null;
  // The measurement as it stands — its next point following the pointer till it's down (not once it's finished).
  const measurePoints: ShapePoint[] = !measure
    ? []
    : !measure.done && pointer && measureOn
      ? [...measure.points, measureEnd(measure.points[measure.points.length - 1], pointer)]
      : measure.points;
  const measureStartAt = measureOn && (!measure || measure.done) && pointer ? lineSnap(pointer) : null;
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
  // A template's own dimension lines (its sizes, each clickable); a Custom outline's cut-outs placed — where each is,
  // how wide and how deep, or how far a cut corner's set back — stacked out from the side each's on (only to read).
  const shownDims = live && !isCustom ? templateDimensions(shape) : (cutouts?.dims ?? []);
  if (live) {
    for (const d of shownDims) {
      const n = d.normal;
      const offset = DIM_OFFSET + (d.tier ?? 0) * (labelHeight + 10);
      const a = v.add(toScreen(d.from), v.mul(n, offset));
      const b = v.add(toScreen(d.to), v.mul(n, offset));
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
        editable: !readOnly && !isCustom,
        title: isCustom ? "Where it's cut out" : cutlistShapeParamLabel(shape.kind, d.key),
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
      // (Said already by a cut-out's dimension: not again.)
      if (closed && cutouts?.covered.includes(i)) continue;
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
  // Every angle that isn't square (shapeCornerAngles — not beside a curve): an arc between its two edges, the short way
  // round, and its degrees just past it, placed with the other numbers. A Custom outline being drawn: each corner it has
  // so far. (Only to read — an angle's set by its lines.)
  const angleArcs: Array<{ key: string; d: string }> = [];
  const cornerAngles: Array<{ index: number; point: ShapePoint; degrees: number; from: ShapePoint; to: ShapePoint; between: ShapePoint; room: number }> = [];
  if (live) {
    const n = live.edges.length;
    for (const angle of shapeCornerAngles(live)) {
      const before = live.edges[(angle.index - 1 + n) % n];
      const after = live.edges[angle.index];
      cornerAngles.push({ ...angle, room: Math.min(before?.vertexLength ?? 0, after?.vertexLength ?? 0) * s });
    }
  } else if (drawing) {
    for (let i = 1; i < points.length - 1; i += 1) {
      const from = v.unit(v.sub(points[i - 1], points[i]));
      const to = v.unit(v.sub(points[i + 1], points[i]));
      const degrees = (Math.acos(Math.max(-1, Math.min(1, v.dot(from, to)))) * 180) / Math.PI;
      if (Math.abs(degrees - 90) < 0.05 || degrees > 179.95 || degrees < 0.05) continue;
      const room = Math.min(distanceBetween(points[i - 1], points[i]), distanceBetween(points[i], points[i + 1])) * s;
      cornerAngles.push({ index: i, point: points[i], degrees, from, to, between: v.unit(v.add(from, to)), room });
    }
  }
  for (const angle of cornerAngles) {
    // (About 20px round — smaller where its edges are short.)
    const r = Math.max(8, Math.min(22, angle.room * 0.4));
    const at = toScreen(angle.point);
    const a = v.add(at, v.mul(angle.from, r));
    const b = v.add(at, v.mul(angle.to, r));
    const sweep = angle.from[0] * angle.to[1] - angle.from[1] * angle.to[0] > 0 ? 1 : 0;
    angleArcs.push({ key: `ang${angle.index}`, d: `M ${a[0]} ${a[1]} A ${r} ${r} 0 0 ${sweep} ${b[0]} ${b[1]}` });
    const text = formatShapeDegrees(angle.degrees);
    const natural = v.add(at, v.mul(angle.between, r + labelHeight / 2 + 8));
    labels.push({
      id: `ang:${angle.index}`,
      text,
      value: angle.degrees,
      editable: false,
      title: "Angle",
      width: labelWidth(text),
      height: labelHeight,
      x: natural[0],
      y: natural[1],
      anchor: v.add(at, v.mul(angle.between, r)),
      normal: angle.between,
    });
  }
  // The typed length's box, in the live length's place: while a length's typed — and on a touch screen, between presses,
  // as a Length box to tap (no keyboard otherwise: tapped, it brings one up).
  // (The line being drawn: from the drawing's last point, or a construction line's first end.)
  const boxFrom = drawing ? lastPoint : lineDrawing ? lineStart : null;
  const boxTo = drawing ? snapped : lineNext;
  const showLengthBox = (drawing || lineDrawing) && !readOnly && view === "2d" && Boolean(boxFrom) && (lengthText !== null || (coarse && !pointer));
  if (boxTo && boxFrom && boxTo.length > 0 && !showLengthBox) {
    const a = toScreen(boxFrom);
    const b = toScreen(boxTo.point);
    const normal = v.unit([a[1] - b[1], b[0] - a[0]]);
    const mid = v.mid(a, b);
    const text = `${formatShapeMm(boxTo.length)} · ${formatShapeMm(boxTo.angle)}°`;
    labels.push({
      id: "live",
      text,
      value: boxTo.length,
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
  // (Kept off a Custom outline's curve handles — each one always there to take hold of.)
  const handleBoxes =
    live && isCustom && !readOnly
      ? live.edges.map((edge) => {
          const at = toScreen(edge.curve ? edge.curve.mid : v.mid(edge.startVertex, edge.endVertex));
          const r = coarse ? 16 : 10;
          return { left: at[0] - r, top: at[1] - r, right: at[0] + r, bottom: at[1] + r };
        })
      : [];
  // (Its numbers off: none — but a number being typed, and the live length of a line being drawn.)
  const shownLabels = dimsOn ? labels : labels.filter((label) => label.live || label.id === editing?.id);
  const placed = size.width > 0 && view === "2d" ? placeShapeLabels(shownLabels, size, { obstacles: handleBoxes }) : [];

  // ---- Its sizes, and its row's fields.
  const outer = live ? live.bounds : pointsBounds(points);
  const footprint = live || points.length >= 2 ? `${formatShapeMm(outer.width)} × ${formatShapeMm(outer.height)} mm` : "—";
  // The ways its grain can run, each at its size now — a cabinet's along its Height, Width or Depth (as its row's are:
  // customCabinetSize), a flat piece's its outer Height or Width. Set by side, so it stays on that side as the shape's
  // resized; none set shows the first, as the rows' Grain toggle does. (A board without a grain: none.)
  const grainChoices: Array<{ axis: Exclude<CutlistShapeGrainAxis, "">; size: number }> = cabinetMode
    ? [
        { axis: "H", size: cabinet.height },
        { axis: "W", size: outer.width },
        { axis: "D", size: outer.height },
      ]
    : [
        { axis: "H", size: outer.height },
        { axis: "W", size: outer.width },
      ];
  const grainIndex = Math.max(0, grainChoices.findIndex((choice) => choice.axis === fields.grain));
  const grainShown = grained ? grainChoices[grainIndex].axis : "";
  // Its edge banding: a flat piece's banded edges, a cabinet's everything along its doors (customCabinetBanding — its
  // shaped parts' doors edges, its ends' fronts, each as many times as there are of it) — each length of it with the
  // excess per end added at both its ends, as the cutlists' edge tape totals have it.
  const excessMm = Math.max(0, Number(bandingExcessPerEndMm) || 0);
  const banding = cabinetMode ? customCabinetBanding(parts) : live ? { mm: live.bandedLengthMm, strips: live.bandedStrips } : { mm: 0, strips: 0 };
  const bandingText = !live
    ? "—"
    : banding.mm > 0 && excessMm > 0
      ? `${formatShapeMetres(banding.mm + 2 * excessMm * banding.strips)} m`
      : `${formatShapeMetres(banding.mm)} m`;
  const grainText = grainShown === "H" ? "Along the height" : grainShown === "W" ? "Along the width" : grainShown === "D" ? "Along the depth" : "None";
  const summary: Array<{ label: string; value: string }> = cabinetMode
    ? [
        { label: "Footprint", value: footprint },
        { label: "Height", value: `${formatShapeMm(cabinet.height)} mm` },
        { label: "Board", value: `${formatShapeMm(boardMm)} mm` },
        { label: "Clashing", value: bandingText },
        { label: "Grain", value: grainText },
      ]
    : [
        { label: "Cut size", value: footprint },
        { label: "Area", value: live ? `${(live.areaMm2 / 1e6).toFixed(2)} m²` : "—" },
        { label: "Clashing", value: bandingText },
        { label: "Grain", value: grainText },
      ];
  const setField = <K extends keyof CutlistShapeEditorFields>(key: K, value: CutlistShapeEditorFields[K]) => {
    if (readOnly) return;
    setFields((prev) => ({ ...prev, [key]: value }));
  };
  // Its Information as the cutlist rows keep it: its lines one after another, a new line between each.
  const infoLines = fields.information.replace(/\r/g, "").split("\n");
  const setInfoLines = (lines: string[]) => setField("information", (lines.length ? lines : [""]).join("\n"));
  // (A row already in the list: these can't be left empty — Save waits.)
  const missing = {
    name: requireFields && shows("name") && !fields.name.trim(),
    board: requireFields && shows("board") && !fields.board.trim(),
    quantity: requireFields && shows("quantity") && !(Number(fields.quantity) > 0),
  };
  const fieldsMissing = missing.name || missing.board || missing.quantity;
  // Its boards as its row's Board cell has them: its sheet's length in a little pill, then its name. (The one it's on,
  // should it not be one of them: by name.)
  const boardDropdownOptions = [
    ...(boardOptions ?? []).map((option) => ({
      value: option.value,
      label: option.label || option.value,
      icon: option.sheet ? (
        <span
          className="inline-flex h-5 min-w-[28px] items-center justify-center rounded-full px-2 text-[10px] font-medium"
          style={{ backgroundColor: "color-mix(in srgb, currentColor 14%, transparent)" }}
        >
          {option.sheet}
        </span>
      ) : undefined,
    })),
    ...(fields.board && !boardOption ? [{ value: fields.board, label: fields.board }] : []),
  ];

  const save = () => {
    if (readOnly || !live || drawing || crosses || fieldsMissing) return;
    const out = withWhatItIs(isCustom ? normalizeCustomShape(shape).shape : shape);
    const final = normalizeCutlistShape(cutlistShapeForStorage(out));
    if (!final) return;
    // (Its grain only on a board that has one, and only a way it can run now — the rest's checked as its rows are.)
    const grain = grained && grainChoices.some((choice) => choice.axis === fields.grain) ? fields.grain : "";
    onSave(final, { ...fields, grain });
  };

  // Closed: straight away if nothing's changed since it was opened (or it's view only); else Are you sure? first.
  const requestClose = () => {
    if (readOnly || editorStateKey(shape, base, cabinet, fields, closed) === openedKey) onClose();
    else setConfirmClose(true);
  };

  const tap = coarse ? "Tap" : "Click";
  const hint = measureOn
    ? coarse
      ? `Tap two points for a length, a third for the angle · Esc to stop measuring.`
      : `Click two points for a length, a third for the angle · right-click to finish, again to clear.`
    : readOnly
    ? "View only."
    : drawing
      ? typedSnap
        ? coarse
          ? "Tap the way it goes — the point's put there, that far along."
          : "Point the way it goes, then Enter or click · Esc lets the length go."
        : points.length
          ? coarse
            ? "Tap the first point to close · tap Length to type how long the next line is."
            : "Type a number for the next line's length · click the first point to close."
          : `${tap} to start drawing.`
      : lineMode && view === "2d"
        ? !lineStart
          ? guides.length
            ? `${tap} the outline or a line to start a line · right-click a piece of the outline to cut it away · Esc when done.`
            : `${tap} the outline to start a line · Esc when done.`
          : typedSnap
            ? coarse
              ? "Tap the way it goes — it ends that far along."
              : "Point the way it goes, then Enter or click · Esc lets the length go."
            : coarse
              ? "Tap where it goes next — it stops on the outline or a line · tap Length to type how long."
              : "Click where it goes next — it stops on the outline or a line · type a length · double-click to stop."
        : cabinetMode && view === "2d"
          ? coarse
            ? "Tap an edge to make it doors, a back or an end — or press and hold it to choose."
            : "Click an edge to make it doors, a back or an end — or right-click it to choose."
          : guides.length && view === "2d"
            ? coarse
              ? "Press and hold a piece of the outline to delete it up to the line."
              : "Right-click a piece of the outline to delete it up to the line."
            : "";

  // The tools' keys (the toolbar's tooltips and its ? list say them): V Select, L Line, M Measure, R Rotate 90°, H Flip
  // horizontal (Shift H vertical), S Snap, G Grid, D Dimensions, ? the list. Each says whether it did anything.
  const shortcutList: Array<{ keys: string; what: string }> = [
    { keys: "V", what: "Select" },
    { keys: "L", what: "Line" },
    { keys: "M", what: "Measure" },
    { keys: "Esc", what: "Back to Select (a measurement cleared)" },
    { keys: "Ctrl Z", what: "Undo" },
    { keys: "Ctrl Y / Ctrl Shift Z", what: "Redo" },
    { keys: "R", what: "Rotate 90°" },
    { keys: "H", what: "Flip horizontal" },
    { keys: "Shift H", what: "Flip vertical" },
    { keys: "S", what: "Snap on / off" },
    { keys: "G", what: "Grid on / off" },
    { keys: "D", what: "Dimensions on / off" },
    { keys: "0–9", what: "Type a line's length while drawing" },
    { keys: "?", what: "These keys" },
  ];
  const runShortcut = (rawKey: string, shift: boolean): boolean => {
    const key = rawKey.toLowerCase();
    if (rawKey === "?") {
      setShortcutsOpen((open) => !open);
      return true;
    }
    if (view !== "2d" && key !== "s" && key !== "g" && key !== "d") return false;
    if (key === "v") pickTool("select");
    else if (key === "l") pickTool("line");
    else if (key === "m") pickTool("measure");
    else if (key === "r" && !readOnly) transformBy("rotate");
    else if (key === "h" && !readOnly) transformBy(shift ? "flipV" : "flipH");
    else if (key === "s" && !readOnly) setSnapOn((on) => !on);
    else if (key === "g") setGridOn((on) => !on);
    else if (key === "d") setDimsOn((on) => !on);
    else return false;
    return true;
  };

  // The keys. Escape: an edge's menu closed, the number or length being typed let go, a measurement cleared, back to
  // Select, a field left — else the editor closed. Ctrl/⌘ Z / Y: undo, redo. A number key while a line's being drawn: its length typed
  // (Backspace takes the last digit off, Enter puts the point there) — not while something else is being typed in.
  const onWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const inLengthBox = target !== null && target === lengthInputRef.current;
    const inField = target !== null && !inLengthBox && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const menuOpen = Boolean(document.querySelector('[data-glass-dropdown-menu="true"]'));
    if (event.key === "Escape") {
      // (A menu open — What is it?, Board: it closes itself, the editor stays.)
      if (menuOpen || target?.closest('[data-shape-editor-board="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      if (confirmClose) {
        setConfirmClose(false);
      } else if (confirmClear) {
        setConfirmClear(false);
      } else if (edgeMenu) {
        setEdgeMenu(null);
      } else if (heightText !== null) {
        skipBlurRef.current = true;
        setHeightText(null);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      } else if (editing) {
        skipBlurRef.current = true;
        setEditing(null);
      } else if (lengthText !== null) {
        setLengthText(null);
        lengthInputRef.current?.blur();
      } else if (shortcutsOpen) {
        setShortcutsOpen(false);
      } else if (measureOn) {
        // (Back to Select — or a drawing still open, its Line — the measurement cleared.)
        pickTool(drawing ? "line" : "select");
      } else if (lineMode) {
        // (Back to Select — any line being drawn let go.)
        pickTool("select");
      } else if (inField && target) {
        target.blur();
      } else {
        requestClose();
      }
      return;
    }
    // Ctrl/⌘ Z: undo; Ctrl/⌘ Y, or Ctrl/⌘ Shift Z: redo.
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && (key === "z" || key === "y") && !editing && heightText === null && !inField && !inLengthBox && !readOnly) {
      event.preventDefault();
      event.stopPropagation();
      if (key === "y" || event.shiftKey) redo();
      else undo();
      return;
    }
    // The tools' own keys (not while typing anything — a field, a number, a length).
    const free = !inField && !inLengthBox && !editing && heightText === null && lengthText === null && !menuOpen && !confirmClose && !confirmClear && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (free && runShortcut(event.key, event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const canType = ((drawing && points.length > 0) || lineDrawing) && !readOnly && view === "2d" && !editing && heightText === null && !edgeMenu && !menuOpen;
    if (!canType || inField || inLengthBox || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^[\d.,]$/.test(event.key)) {
      event.preventDefault();
      setLengthText((prev) => cleanLengthText(`${prev ?? ""}${event.key}`));
      // (Its box already showing — a touch screen's, or one a click elsewhere left: typing goes on in it.)
      lengthInputRef.current?.focus();
    } else if (event.key === "Backspace" && lengthText !== null) {
      event.preventDefault();
      setLengthText((prev) => String(prev ?? "").slice(0, -1) || (coarse ? "" : null));
    } else if (event.key === "Enter" && lengthText !== null) {
      event.preventDefault();
      enterLength();
    } else if (event.key === "Enter" && lineDrawing) {
      event.preventDefault();
      endLineRun();
    }
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => onWindowKeyDown(event);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  // A cabinet or a flat piece of one of the company's part types: washed in that part type's colour.
  const chosenOption = base ? baseOptions?.find((option) => option.partType === base.partType) : undefined;
  const wash = chosenOption?.color || color || "#CBD5E1";
  const baseDropdownOptions = [
    ...(baseOptions ?? []).map((option) => ({ value: option.partType, label: option.partType, color: option.color })),
    ...(base && !chosenOption ? [{ value: base.partType, label: base.partType || "—" }] : []),
  ];
  // A run as one line — its edges, and the curves of the corners between them — so its highlight never doubles up.
  const runPath = (runIndex: number) => (live ? shapeChainPath(live, shapeRunChain(live, runIndex), toScreen, s) : "");
  // An edge's menu, while what it's for is still there; a cabinet's edge picked out — the one its menu's open for, else
  // the one under the pointer.
  const menuEdge =
    edgeMenu &&
    view === "2d" &&
    live &&
    (edgeMenu.guide !== null ? guides.some((guide) => guide.id === edgeMenu.guide) : edgeMenu.edge !== null && Boolean(live.edges[edgeMenu.edge]))
      ? edgeMenu
      : null;
  const litEdge = (cabinetMode ? menuEdge?.edge : null) ?? hoverEdge;
  // Once lines are drawn, what's picked out — under the pointer, or what a menu's open for — is just the piece between
  // the crossings either side (shapeCutPieceAt): a line's own piece; a piece of the outline only where a line's split
  // its edge (else its run, or a cabinet's edge, as ever). Delete line pointed at in the menu: what it'd cut away too,
  // shaded.
  // Delete line on a piece of the outline, worked out before it's offered: refused (it'd break the shape — in two, open,
  // with a hole, crossing itself), it's shown off with why, nothing shaded, nothing done.
  const menuCut =
    menuEdge && menuEdge.guide === null && menuEdge.edge !== null && menuEdge.at && guides.length && live
      ? cutShapeFace(cabinetMode && cabShape ? cabShape : shape, cutLines, { edge: menuEdge.edge, at: menuEdge.at }, cabinetMode ? { edgeRoles: roles } : {})
      : null;
  const cutRefusal = (reason: string) =>
    reason === "nothing"
      ? "No line closes this piece off"
      : reason === "split"
        ? "Would break the shape in two"
        : reason === "hole"
          ? "Would leave a hole"
          : reason === "curve"
            ? "A line crosses a curve"
            : "Would break the shape";
  const litPiece = (() => {
    if (!live || !guides.length || curveDrag || view !== "2d") return null;
    const guideIndex = (id: number) => guides.findIndex((guide) => guide.id === id);
    let target: { edge: number | null; line: number | null; at: ShapePoint } | null = null;
    if (menuEdge && menuEdge.at) {
      target = menuEdge.guide !== null ? { edge: null, line: guideIndex(menuEdge.guide), at: menuEdge.at } : { edge: menuEdge.edge, line: null, at: menuEdge.at };
    } else if (hoverGuide) {
      target = { edge: null, line: guideIndex(hoverGuide.id), at: hoverGuide.at };
    } else if (hoverAt && (hoverRun !== null || hoverEdge !== null)) {
      target = { edge: cabinetMode && hoverEdge !== null ? hoverEdge : nearestEdge(hoverAt), line: null, at: hoverAt };
    }
    if (!target || (target.line !== null && target.line < 0)) return null;
    const piece = shapeCutPieceAt(shape, cutLines, target);
    if (!piece) return null;
    if (target.edge !== null) {
      const p = outlineVertices[target.edge];
      const q = outlineVertices[(target.edge + 1) % outlineVertices.length];
      // (Its whole edge: no line splits it — picked out as ever, unless Delete line's being pointed at.)
      const whole = p && q && distanceBetween(piece.from, piece.to) >= distanceBetween(p, q) - 0.5;
      if (whole && !(menuEdge && deleteHover && menuCut?.ok)) return null;
    }
    return { ...piece, face: menuEdge && deleteHover && menuCut?.ok ? piece.face : null };
  })();

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
            fill={label.editable ? "var(--brand-strong)" : "var(--text-main)"}
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

  // The typed length's box: off the middle of the line it sets, where the live length sits — nothing aimed yet, just
  // past the last point, the way the next line would go. Then "mm", and the line's angle once there's a line. (With a
  // mouse the pointer goes through it, so the line can still be aimed and clicked; on a touch screen it's tapped.)
  const lengthBox = (() => {
    if (!showLengthBox || !boxFrom) return null;
    const a = toScreen(boxFrom);
    const aimed = Boolean(boxTo && boxTo.length > 0);
    let at = v.add(a, v.mul(onward, 56));
    if (boxTo && aimed) {
      const b = toScreen(boxTo.point);
      at = v.add(v.mid(a, b), v.mul(v.unit([a[1] - b[1], b[0] - a[0]]), 16));
    }
    const width = aimed ? 150 : 116;
    const height = coarse ? 34 : 28;
    const left = Math.min(Math.max(4, at[0] - width / 2), Math.max(4, size.width - width - 4));
    const top = Math.min(Math.max(4, at[1] - height / 2), Math.max(4, size.height - height - 4));
    return (
      <div
        className="absolute z-10 flex items-center gap-1 rounded-full border pl-1 pr-3"
        style={{
          left,
          top,
          width,
          height,
          borderColor: drawing && snappedCrosses ? "var(--danger)" : "var(--brand)",
          backgroundColor: "var(--panel-bg)",
          boxShadow: "0 4px 14px rgba(15, 23, 42, 0.18)",
          pointerEvents: coarse ? "auto" : "none",
        }}
      >
        <input
          ref={lengthInputRef}
          autoFocus={!coarse}
          inputMode="decimal"
          enterKeyHint="done"
          aria-label="Length of the line (mm)"
          placeholder="Length"
          value={lengthText ?? ""}
          onFocus={(event) => {
            if (lengthText === null) setLengthText("");
            // (After the digit that opened it — not over it.)
            const end = event.currentTarget.value.length;
            event.currentTarget.setSelectionRange(end, end);
          }}
          onChange={(event) => setLengthText(cleanLengthText(event.target.value) || (coarse ? "" : null))}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            enterLength();
          }}
          onBlur={() => {
            if (lengthText === "") setLengthText(null);
          }}
          className="h-full min-w-0 flex-1 rounded-full bg-transparent px-1 text-center text-[13px] font-medium outline-none"
          style={{ color: "var(--text-main)" }}
        />
        <span className="shrink-0 whitespace-nowrap text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
          mm{boxTo && aimed ? ` · ${formatShapeMm(boxTo.angle)}°` : ""}
        </span>
      </div>
    );
  })();

  // ---- 2D.
  const render2d = () => {
    const hit = coarse ? 22 : 14;
    // The 100mm grid behind a Custom outline (500mm when 100 would be too close together).
    const grid = (() => {
      if (!gridOn || size.width <= 0) return null;
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
        // (A long press on a cabinet's edge is its menu — not the phone's own callout. Fingers on it are the drawing's —
        // a pinch zooms it — not the page's to scroll or zoom.)
        style={{ touchAction: "none", WebkitTouchCallout: "none" }}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const [x, y] = toMm(event.clientX - box.left, event.clientY - box.top);
          if (statusAtRef.current) statusAtRef.current.textContent = `X ${formatShapeMm(x)}  Y ${formatShapeMm(y)}`;
        }}
        onPointerLeave={() => {
          if (statusAtRef.current) statusAtRef.current.textContent = "";
        }}
      >
        {/* The drawing's empty space: dragged, the view moves. */}
        {!(drawing && !readOnly) ? (
          <rect
            x={0}
            y={0}
            width={size.width}
            height={size.height}
            fill="transparent"
            style={{ cursor: panning ? "grabbing" : "grab" }}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
          />
        ) : null}
        {drawing && !readOnly ? (
          <rect
            x={0}
            y={0}
            width={size.width}
            height={size.height}
            fill="transparent"
            // (The closed hand while the middle button moves it.)
            style={{ cursor: panning ? "grabbing" : "crosshair" }}
            onPointerDown={onDrawPointerDown}
            onPointerMove={onDrawPointerMove}
            onPointerUp={onDrawPointerUp}
            onPointerCancel={() => setPointer(null)}
            onPointerLeave={(event) => {
              // (A length being typed keeps the way it was last pointed.)
              if (event.pointerType === "mouse" && lengthText === null) setPointer(null);
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
            {/* What Delete line would cut away, shaded. */}
            {litPiece?.face ? (
              <polygon points={pts(litPiece.face.map(toScreen))} fill="var(--danger)" fillOpacity={0.16} stroke="var(--danger)" strokeOpacity={0.5} strokeWidth={1} pointerEvents="none" />
            ) : null}
            {/* Just the piece between crossings. */}
            {litPiece ? (
              <line
                x1={toScreen(litPiece.from)[0]}
                y1={toScreen(litPiece.from)[1]}
                x2={toScreen(litPiece.to)[0]}
                y2={toScreen(litPiece.to)[1]}
                stroke={menuEdge && deleteHover && (menuCut?.ok || menuEdge.guide !== null) ? "var(--danger)" : "var(--brand)"}
                strokeOpacity={0.35}
                strokeWidth={11}
                strokeLinecap="round"
                pointerEvents="none"
              />
            ) : null}
            {cabinetMode && litEdge !== null && !litPiece && !curveDrag && live.edges[litEdge] ? (
              <path
                d={shapeChainPath(
                  live,
                  roles[litEdge] === "doors" ? shapeRunChain(live, live.edges[litEdge].run) : { edges: [litEdge], closed: false },
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
            {!cabinetMode && hoverRun !== null && !litPiece && !curveDrag ? (
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
            {/* A cabinet's edges, each clickable: Doors → Back → End (a doors run as one). Right-clicked, or held on a
                touch screen: its menu, to pick which. */}
            {cabinetMode && !readOnly
              ? live.edges.map((edge) => {
                  const role = roles[edge.index];
                  const label = role ? CABINET_EDGE_ROLE_LABELS[role] : "Edge";
                  return (
                    <g
                      key={`edge${edge.index}`}
                      role="button"
                      aria-label={`${label} — click to change`}
                      aria-haspopup="menu"
                      style={{ cursor: "pointer" }}
                      onPointerEnter={() => setHoverEdge(edge.index)}
                      onPointerLeave={() => {
                        setHoverEdge((prev) => (prev === edge.index ? null : prev));
                        setHoverAt(null);
                        endEdgeHold();
                      }}
                      {...menuHandlers((event) => pieceAt(event, edge.index), trackHoverAt)}
                      onClick={() => {
                        if (!tapAfterHold()) tapCabinetEdge(edge.index);
                      }}
                    >
                      <title>{`${label} — click for ${role === "doors" ? "a back" : role === "back" ? "an end" : "doors"}, or right-click to choose`}</title>
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
                    onPointerLeave={() => {
                      setHoverRun((prev) => (prev === run.index ? null : prev));
                      setHoverAt(null);
                      endEdgeHold();
                    }}
                    {...menuHandlers((event) => pieceAt(event), trackHoverAt)}
                    onClick={() => {
                      if (!tapAfterHold()) commitShape(toggleShapeRunBanding(shape, run.edges[0]));
                    }}
                  >
                    <title>{run.banded ? "Banded — click to take it off" : "Click to band this edge"}</title>
                    <path d={runPath(run.index)} fill="none" stroke="transparent" strokeWidth={hit} strokeLinecap="round" strokeLinejoin="round" pointerEvents="stroke" />
                  </g>
                ))
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
        {(dimsOn ? dimLines : []).map((dim) => {
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
        {/* Each angle's arc, between its two edges. */}
        {dimsOn && angleArcs.length ? (
          <g fill="none" stroke="var(--text-main)" strokeWidth={1.5} strokeLinecap="round" pointerEvents="none">
            {angleArcs.map((arc) => (
              <path key={arc.key} d={arc.d} />
            ))}
          </g>
        ) : null}
        {/* The lines drawn: solid, in the brand blue till they're used — right-clicked (or held), Delete line. */}
        {live
          ? guides.map((guide) => {
              const a = toScreen(guide.a);
              const b = toScreen(guide.b);
              const lit = menuEdge?.guide === guide.id;
              return (
                <g
                  key={`guide${guide.id}`}
                  role={readOnly ? undefined : "button"}
                  aria-label="Line — right-click to delete it"
                  aria-haspopup="menu"
                  style={{ cursor: "context-menu" }}
                  onPointerLeave={() => {
                    setHoverGuide(null);
                    endEdgeHold();
                  }}
                  {...menuHandlers(
                    (event) => ({ edge: null, guide: guide.id, at: pieceAt(event).at }),
                    (event) => setHoverGuide({ id: guide.id, at: pieceAt(event).at }),
                  )}
                >
                  <title>Line — right-click to delete it</title>
                  <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="transparent" strokeWidth={coarse ? 22 : 14} pointerEvents="stroke" />
                  <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="var(--brand)" strokeWidth={lit ? 2.4 : 1.5} strokeLinecap="round" pointerEvents="none" />
                  <circle cx={a[0]} cy={a[1]} r={2.5} fill="var(--brand)" pointerEvents="none" />
                  <circle cx={b[0]} cy={b[1]} r={2.5} fill="var(--brand)" pointerEvents="none" />
                </g>
              );
            })
          : null}
        {lineMode && live ? (
          <g pointerEvents="none">
            {lineStartAt ? <circle cx={toScreen(lineStartAt)[0]} cy={toScreen(lineStartAt)[1]} r={5} fill="none" stroke="var(--brand)" strokeWidth={1.5} /> : null}
            {lineStart ? <circle cx={toScreen(lineStart)[0]} cy={toScreen(lineStart)[1]} r={4} fill="var(--brand)" /> : null}
            {lineStart && lineNext ? (
              <>
                <line
                  x1={toScreen(lineStart)[0]}
                  y1={toScreen(lineStart)[1]}
                  x2={toScreen(lineNext.point)[0]}
                  y2={toScreen(lineNext.point)[1]}
                  stroke="var(--brand)"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeOpacity={0.75}
                />
                <circle cx={toScreen(lineNext.point)[0]} cy={toScreen(lineNext.point)[1]} r={4} fill="none" stroke="var(--brand)" strokeWidth={1.5} />
              </>
            ) : null}
          </g>
        ) : null}
        {placed.map(renderLabel)}
    {/* A Custom outline's curve handles: one at each segment's middle (a curve's, the middle of its curve) —
        dragged to bow it, clicked to type its height. Over the numbers (which are kept off them), so one's always
        there to take hold of. */}
        {live && isCustom && !readOnly
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
        {/* Add line: its own layer over everything else, so a press is a line's (not an edge's or a number's) — its
            right-click the menu of what's under it, or a run of lines ended. */}
        {/* The measurement: a dashed line through its points, each leg's length (mm) — and, three points, the angle at the
            middle one, with a little arc. */}
        {measurePoints.length ? (
          (() => {
            const screen = measurePoints.map(toScreen);
            const pill = (key: string, text: string, at: ShapePoint) => {
              const width = text.length * 6.8 + 16;
              const x = Math.min(Math.max(4, at[0] - width / 2), Math.max(4, size.width - width - 4));
              const y = Math.min(Math.max(4, at[1] - 11), Math.max(4, size.height - 26));
              return (
                <g key={key}>
                  <rect x={x} y={y} width={width} height={22} rx={11} fill="var(--panel-bg)" fillOpacity={0.96} stroke="var(--brand)" strokeWidth={1} />
                  <text x={x + width / 2} y={y + 11} dy="0.35em" textAnchor="middle" fontSize={12} fontWeight={500} fill="var(--text-main)">
                    {text}
                  </text>
                </g>
              );
            };
            const legs = screen.slice(1).map((b, i) => {
              const a = screen[i];
              const normal = v.unit([a[1] - b[1], b[0] - a[0]]);
              return pill(`leg${i}`, formatShapeMm(distanceBetween(measurePoints[i], measurePoints[i + 1])), v.add(v.mid(a, b), v.mul(normal, 16)));
            });
            let angle: ReactNode = null;
            if (screen.length === 3) {
              const [a, b, c] = screen;
              const toA = v.unit(v.sub(a, b));
              const toC = v.unit(v.sub(c, b));
              const degrees = (Math.acos(Math.max(-1, Math.min(1, v.dot(toA, toC)))) * 180) / Math.PI;
              const r = 22;
              const p = v.add(b, v.mul(toA, r));
              const q = v.add(b, v.mul(toC, r));
              const sweep = toA[0] * toC[1] - toA[1] * toC[0] > 0 ? 1 : 0;
              const between = v.unit(v.add(toA, toC));
              angle = (
                <g>
                  <path d={`M ${p[0]} ${p[1]} A ${r} ${r} 0 0 ${sweep} ${q[0]} ${q[1]}`} fill="none" stroke="var(--brand-strong)" strokeWidth={1.5} />
                  {pill("angle", `${formatShapeMm(degrees)}°`, v.add(b, v.mul(Math.hypot(between[0], between[1]) > 1e-6 ? between : [0, -1], r + 18)))}
                </g>
              );
            }
            return (
              <g pointerEvents="none">
                {screen.length >= 2 ? <polyline points={pts(screen)} fill="none" stroke="var(--brand-strong)" strokeWidth={1.5} strokeDasharray="5 4" /> : null}
                {screen.map((at, i) => (
                  <circle key={`m${i}`} cx={at[0]} cy={at[1]} r={4} fill="var(--panel-bg)" stroke="var(--brand-strong)" strokeWidth={1.5} />
                ))}
                {angle}
                {legs}
              </g>
            );
          })()
        ) : null}
        {measureStartAt ? (
          <circle cx={toScreen(measureStartAt)[0]} cy={toScreen(measureStartAt)[1]} r={5} fill="none" stroke="var(--brand)" strokeWidth={1.5} pointerEvents="none" />
        ) : null}
        {measureOn ? (
          <rect
            x={0}
            y={0}
            width={size.width}
            height={size.height}
            fill="transparent"
            style={{ cursor: panning ? "grabbing" : "crosshair" }}
            onPointerDown={onMeasurePointerDown}
            onPointerMove={(event) => {
              if (movePan(event) || pinchRef.current) return;
              setPointer(localPoint(event));
            }}
            onPointerUp={onMeasurePointerUp}
            onContextMenu={onMeasureContextMenu}
            onPointerCancel={() => setPointer(null)}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setPointer(null);
            }}
          />
        ) : null}
        {lineMode && live && !readOnly ? (
          <rect
            x={0}
            y={0}
            width={size.width}
            height={size.height}
            fill="transparent"
            // (The closed hand while the middle button moves it.)
            style={{ cursor: panning ? "grabbing" : "crosshair" }}
            onPointerDown={onLinePointerDown}
            onPointerMove={onLinePointerMove}
            onPointerUp={onLinePointerUp}
            onDoubleClick={endLineRun}
            onContextMenu={onLineContextMenu}
            onPointerCancel={() => setPointer(null)}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse" && lengthText === null) setPointer(null);
            }}
          />
        ) : null}
      </svg>
    );
  };

  // ---- 3D, a flat piece: a slab of its outline in its board's thickness, lying flat — the cabinet's own 3D view
  // (components/cutlist-cabinet-3d.tsx: dragged to move it, right-dragged to turn it, the wheel to zoom), its banded
  // sides in the banding's colour (lib/cutlist-cabinet-shape.ts's flatPieceModel).
  const flat = useMemo(() => (live && !cabinetMode ? flatPieceModel(shown, boardMm) : null), [boardMm, cabinetMode, live, shown]);
  // In 3D, an edge's face clicked sets that edge as a click on it in 2D does — a flat piece's side, its run's banding; a
  // cabinet's back, end or door panel, its edge's role (on round) — and the one under the pointer's picked out (a flat
  // piece's whole run, as in 2D).
  const edgeOf3dFace = (face: Cabinet3dFace | null): number | null => {
    if (!face) return null;
    if (cabinetMode) {
      const match = face.part.match(/^(?:back|end|door):(\d+)$/);
      return match ? Number(match[1]) : null;
    }
    return flat?.sideEdges.get(face.key) ?? null;
  };
  const tapFace3d = (face: Cabinet3dFace) => {
    const edge = edgeOf3dFace(face);
    if (edge === null || readOnly || !live) return;
    if (cabinetMode) tapCabinetEdge(edge);
    else commitShape(toggleShapeRunBanding(shape, edge));
  };
  const litFaces3d = useMemo(() => {
    if (!hover3d || !flat || !live || cabinetMode) return undefined;
    const edge = flat.sideEdges.get(hover3d.key);
    const run = edge === undefined ? undefined : live.edges[edge]?.run;
    if (run === undefined) return undefined;
    return new Set([...flat.sideEdges].filter(([, e]) => live.edges[e]?.run === run).map(([key]) => key));
  }, [cabinetMode, flat, hover3d, live]);
  const hoverPart3d = cabinetMode && hover3d && /^(?:back|end|door):\d+$/.test(hover3d.part) ? hover3d.part : null;

  // ---- Export: the 2D drawing with all its numbers, or the 3D view as it's seen with its overall sizes — as a PNG or a
  // PDF (lib/cutlist-shape-export.ts), named after it.
  const exportTitle = { name: fields.name, partType, room, board: boardOption?.label || fields.board };
  const build2d: ShapeDrawingBuilder = (size2d) => {
    if (cabinetMode && cabShape) return cabinetPlanDrawingOps(withWhatItIs(cabShape), { ...size2d, thicknessMm: boardMm, background: "#FFFFFF" });
    return shapeDrawingOps(isCustom ? normalizeCustomShape(shape).shape : shape, { ...size2d, background: "#FFFFFF" });
  };
  const build3d: ShapeDrawingBuilder = (size3d) =>
    cabinetMode && model
      ? cabinet3dDrawingOps(model, view3d, { ...size3d, color: wash, showRoles: rolesShown })
      : cabinet3dDrawingOps(flat?.model ?? { prisms: [], height: 0, thicknessMm: 0, bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 } }, view3d, {
          ...size3d,
          color: wash,
          bandedFaces: flat?.bandedFaces,
          bandColor: CUTLIST_SHAPE_BAND_COLOR,
          axisLabels: { x: "W", y: "H", z: "T" },
        });
  const exportItems = [
    { key: "2d-png", label: "2D drawing", detail: "PNG", icon: <ImageIcon size={14} />, onSelect: () => downloadShapeDrawingPng(build2d, shapeExportFileName(exportTitle, "2D", "png")) },
    { key: "2d-pdf", label: "2D drawing", detail: "PDF", icon: <FileText size={14} />, onSelect: () => void downloadShapeDrawingPdf(build2d, exportTitle, shapeExportFileName(exportTitle, "2D", "pdf")) },
    { key: "3d-png", label: "3D view", detail: "PNG", icon: <ImageIcon size={14} />, onSelect: () => downloadShapeDrawingPng(build3d, shapeExportFileName(exportTitle, "3D", "png")) },
    { key: "3d-pdf", label: "3D view", detail: "PDF", icon: <FileText size={14} />, onSelect: () => void downloadShapeDrawingPdf(build3d, exportTitle, shapeExportFileName(exportTitle, "3D", "pdf")) },
  ];

  // ---- The pop-up: the drawing, and beside it — under it, on a phone — its panel, Save at the panel's foot (always in
  // sight). The panel's sections each under a small heading, its fields laid out as the app's other pop-ups lay theirs.
  // The shapes it can be, each with its little picture — big in the menu and the trigger (most of their height).
  const kindGlyph = (kind: CutlistShapeKind, sizePx: number) => (
    <svg width={sizePx} height={sizePx} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <polygon points={KIND_GLYPHS[kind]} fill="currentColor" fillOpacity={0.18} stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
  // (A plain rectangle isn't offered — a row without a shape still opens on one, rectShapeFromSize: then it's there too,
  // for what it is now.)
  const shapeKindOptions = CUTLIST_SHAPE_KINDS.filter((option) => option.kind !== "rect" || shape.kind === "rect").map((option) => ({ value: option.kind, label: option.label, icon: kindGlyph(option.kind, 22) }));
  // (Every tool the same size — the shape's dropdown too.)
  // (On — Snap, Add line, Close shape: the brand glass, white text; else the plain glass.)
  const toolBaseClass =
    "glass-shine inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium transition hover:brightness-[0.97] disabled:opacity-45";
  const toolOnClass = `${toolBaseClass} text-white`;
  // (The view's + / − / Fit, stacked over the drawing's bottom right.)
  const zoomButtonClass =
    "inline-flex h-9 w-9 items-center justify-center text-[var(--text-main)] transition hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] disabled:opacity-40";
  const subtitle = [partType, room].map((part) => String(part || "").trim()).filter(Boolean).join(" · ");
  // A piece that picks what it is: its fields wait until it's picked.
  const needsBase = Boolean(baseOptions?.length) && !base;
  const sectionClass = "grid gap-3 border-t px-4 py-4 first:border-t-0";
  const headingClass = "text-[11px] font-medium uppercase tracking-[0.8px]";
  const fieldClass = "grid gap-1.5 text-[12px] font-medium";
  const mainText = { color: "var(--text-main)" } as const;
  const lineColor = { borderColor: "var(--glass-border)" } as const;
  const showGrain = shows("grain") && grained;
  const showPiece = shows("name") || shows("board") || shows("quantity") || shows("information") || showGrain || cabinetMode;
  const needed = (on: boolean) =>
    on ? (
      <span className="ml-1.5" style={{ color: "var(--danger-strong)" }}>
        Needed
      </span>
    ) : null;
  const saveBlocked = !live || drawing || crosses || fieldsMissing;
  // 2D or 3D — the switch over the drawing's top right corner (3D's Reset view is over its top left).
  const changeView = (next: "2d" | "3d", turn: View3dTurnStart | null = null) => {
    if (next === view) return;
    setView(next);
    setTurnStart(next === "3d" ? turn : null);
    setHover3d(null);
    setEditing(null);
    setHoverRun(null);
    setHoverEdge(null);
    setEdgeMenu(null);
    setLengthText(null);
    setLineMode(false);
    setLineStart(null);
    setMeasureOn(false);
    setMeasure(null);
  };
  const menuEdgeIndex = menuEdge?.edge ?? null;
  const menuGuide = menuEdge?.guide ?? null;
  const menuAt = menuEdge?.at ?? null;
  const edgeMeetings = cabinetMode && menuEdgeIndex !== null ? backMeetings(menuEdgeIndex) : [];
  return (
    <>
      <GlassModalHeader
        icon={<Shapes />}
        title={
          <>
            Custom shape
            {subtitle ? (
              <span className="ml-2 text-[13px] font-medium normal-case tracking-normal" style={mainText}>
                {subtitle}
              </span>
            ) : null}
          </>
        }
        onClose={requestClose}
      />

      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(0,1fr)_312px] md:grid-rows-[minmax(0,1fr)_auto]">
        {/* (A phone: one scroll — the drawing, then the panel. A bigger screen: side by side, the panel scrolling on its
            own.) */}
        <div className="glass-scroll min-h-0 flex-1 overflow-y-auto md:contents">
          <div className="flex flex-col gap-2 px-5 pb-3 pt-3 max-md:px-4 md:col-start-1 md:row-span-2 md:row-start-1 md:min-h-0 md:min-w-0">
            {/* The toolbar, one row, always the same tools (those that don't apply greyed, never gone): its shape | Select,
                Line, Measure | Undo, Redo, Clear | Rotate 90°, Flip horizontal, Flip vertical | Snap, Grid, Dimensions |
                Export, and the keys' list. View only: the view's own — Measure, the toggles, Export. One row in the
                pop-up's drawing column (about 660px of ~720: the shape 120, four groups of three 34px buttons, Export
                and ? 36 each, 6px between); narrower, the groups wrap whole onto a second row — on a phone, it scrolls
                sideways instead. (The zoom is over the drawing's bottom right; 2D / 3D its top right.) */}
            <div
              className="glass-scroll -mx-1 flex items-center gap-1.5 px-1 pb-0.5 max-md:overflow-x-auto md:flex-wrap"
              role="toolbar"
              aria-label="Drawing tools"
            >
              {/* Its shape: one dropdown of them (L corner, U shape, Notch, Angled, Custom), each with its picture. */}
              <GlassDropdown
                value={shape.kind}
                options={shapeKindOptions}
                onChange={(kind) => switchKind(kind as CutlistShapeKind)}
                ariaLabel="Shape"
                disabled={readOnly}
                menuMinWidth={190}
                triggerClassName="glass-shine glass-shine-neutral h-9 min-w-[120px] shrink-0 rounded-full border pl-1.5 pr-2 text-[12px] font-medium text-[var(--text-main)]"
              />
              <ToolGroup
                label="Tools"
                tools={[
                  ...(readOnly ? [] : [{ key: "select", name: "Select", keys: "V", icon: <MousePointer2 size={16} />, on: activeTool === "select", disabled: drawing || view !== "2d", onClick: () => pickTool("select") }]),
                  ...(readOnly ? [] : [{ key: "line", name: "Line", keys: "L", icon: <PenLine size={16} />, on: activeTool === "line", disabled: view !== "2d" || (!drawing && !live), onClick: () => pickTool(activeTool === "line" && !drawing ? "select" : "line") }]),
                  { key: "measure", name: "Measure", keys: "M", icon: <Ruler size={16} />, on: activeTool === "measure", disabled: view !== "2d", onClick: () => pickTool(measureOn ? (drawing ? "line" : "select") : "measure") },
                ]}
              />
              {!readOnly ? (
                <ToolGroup
                  label="Edit"
                  tools={[
                    { key: "undo", name: "Undo", keys: "Ctrl Z", icon: <Undo2 size={16} />, disabled: !history.length, onClick: undo },
                    { key: "redo", name: "Redo", keys: "Ctrl Y", icon: <Redo2 size={16} />, disabled: !future.length, onClick: redo },
                    { key: "clear", name: "Clear", keys: "", icon: <Eraser size={16} />, disabled: !isCustom || !points.length, onClick: requestClear },
                  ]}
                />
              ) : null}
              {!readOnly ? (
                <ToolGroup
                  label="Turn and flip"
                  tools={[
                    { key: "rotate", name: "Rotate 90°", keys: "R", icon: <RotateCw size={16} />, disabled: !live || drawing || view !== "2d", onClick: () => transformBy("rotate") },
                    { key: "flip-h", name: "Flip horizontal", keys: "H", icon: <FlipHorizontal2 size={16} />, disabled: !live || drawing || view !== "2d", onClick: () => transformBy("flipH") },
                    { key: "flip-v", name: "Flip vertical", keys: "Shift H", icon: <FlipVertical2 size={16} />, disabled: !live || drawing || view !== "2d", onClick: () => transformBy("flipV") },
                  ]}
                />
              ) : null}
              <ToolGroup
                label="Show"
                tools={[
                  ...(readOnly ? [] : [{ key: "snap", name: "Snap", keys: "S", icon: <Magnet size={16} />, on: snapOn, onClick: () => setSnapOn((on) => !on) }]),
                  { key: "grid", name: "Grid", keys: "G", icon: <Grid3x3 size={16} />, on: gridOn, disabled: view !== "2d", onClick: () => setGridOn((on) => !on) },
                  { key: "dims", name: "Dimensions", keys: "D", icon: <RulerDimensionLine size={16} />, on: dimsOn, disabled: view !== "2d", onClick: () => setDimsOn((on) => !on) },
                ]}
              />
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {/* (Its icon alone — its name in its tooltip — so the row fits.) */}
                <span title="Export" className="inline-flex">
                  <GlassActionMenu
                    items={exportItems}
                    ariaLabel="Export"
                    openWithOneItem
                    menuMinWidth={200}
                    triggerClassName={`glass-shine glass-shine-neutral inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[var(--text-main)] transition hover:brightness-[0.97] ${!live || drawing ? "pointer-events-none opacity-45" : ""}`}
                  >
                    <Download size={16} />
                  </GlassActionMenu>
                </span>
                <div className="relative">
                  <button
                    type="button"
                    aria-expanded={shortcutsOpen}
                    onClick={() => setShortcutsOpen((open) => !open)}
                    className="glass-shine glass-shine-neutral inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[var(--text-main)] transition hover:brightness-[0.97]"
                    title="Keyboard shortcuts (?)"
                    aria-label="Keyboard shortcuts"
                  >
                    <CircleHelp size={16} />
                  </button>
                </div>
              </div>
            </div>
            {/* The keys, listed (? — closed by Escape, or a click anywhere else). */}
            {shortcutsOpen ? <ShortcutsPopover list={shortcutList} onClose={() => setShortcutsOpen(false)} /> : null}

            <div
              ref={stageRef}
              data-swipe-close="off"
              onPointerDownCapture={onStageTouchDown}
              onPointerMoveCapture={onStageTouchMove}
              onPointerUpCapture={onStageTouchUp}
              onPointerCancelCapture={onStageTouchUp}
              className="relative h-[46dvh] min-h-[240px] shrink-0 overflow-hidden rounded-[14px] border md:h-auto md:min-h-[220px] md:flex-1"
              style={{ ...lineColor, backgroundColor: "color-mix(in srgb, var(--panel-bg) 70%, transparent)" }}
            >
              {size.width > 0 && size.height > 0 ? (
                view === "3d" ? (
                  cabinetMode ? (
                    <CutlistCabinet3d
                      model={model ?? { prisms: [], height: 0, thicknessMm: 0, bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 } }}
                      width={size.width}
                      height={size.height}
                      color={wash}
                      highlight={hoverPart ?? hoverPart3d}
                      showRoles={rolesShown}
                      setShowRoles={setRolesShown}
                      view={view3d}
                      setView={setView3d}
                      startTurn={turnStart}
                      onFaceTap={readOnly ? undefined : tapFace3d}
                      onFaceHover={readOnly ? undefined : setHover3d}
                    />
                  ) : (
                    <CutlistCabinet3d
                      model={flat?.model ?? { prisms: [], height: 0, thicknessMm: 0, bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 } }}
                      width={size.width}
                      height={size.height}
                      color={wash}
                      bandedFaces={flat?.bandedFaces}
                      bandColor={CUTLIST_SHAPE_BAND_COLOR}
                      litFaces={litFaces3d}
                      view={view3d}
                      setView={setView3d}
                      startTurn={turnStart}
                      onFaceTap={readOnly ? undefined : tapFace3d}
                      onFaceHover={readOnly ? undefined : setHover3d}
                    />
                  )
                ) : (
                  render2d()
                )
              ) : null}
              {view === "2d" ? editBox : null}
              {lengthBox}
              {/* 2D or 3D: a click anywhere on it flips it (Segmented's flip). (Its own press: never a point, a line or
                  a drag on the drawing under it.) */}
              <div className="absolute right-3 top-3 z-10" onPointerDown={(event) => event.stopPropagation()}>
                <Segmented
                  size="sm"
                  pill
                  tone="brand"
                  strongText
                  flip
                  value={view}
                  options={[
                    { value: "2d", label: "2D" },
                    { value: "3d", label: "3D" },
                  ]}
                  onChange={changeView}
                />
              </div>
              {/* Zoom in and out, and Fit — 2D (3D has its own: the wheel, a pinch, Reset view). (Its own presses: never a
                  point or a drag on the drawing under it.) */}
              {view === "2d" ? (
                <div
                  className="glass-shine glass-shine-neutral absolute bottom-3 right-3 z-10 flex flex-col overflow-hidden rounded-[14px] border"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button type="button" onClick={() => zoomAt(size.width / 2, size.height / 2, 1.25)} className={zoomButtonClass} aria-label="Zoom in" title="Zoom in (or the mouse wheel, or pinch)">
                    <Plus size={17} strokeWidth={2.2} />
                  </button>
                  <span aria-hidden="true" className="mx-2 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
                  <button type="button" onClick={() => zoomAt(size.width / 2, size.height / 2, 1 / 1.25)} className={zoomButtonClass} aria-label="Zoom out" title="Zoom out (or the mouse wheel, or pinch)">
                    <Minus size={17} strokeWidth={2.2} />
                  </button>
                  <span aria-hidden="true" className="mx-2 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
                  <button type="button" onClick={fitView} className={zoomButtonClass} aria-label="Fit" title="Fit the drawing to the view">
                    <Maximize2 size={16} strokeWidth={2.2} />
                  </button>
                </div>
              ) : null}
              {/* A cabinet's roles, what colour each is (and every edge back as it started). */}
              {cabinetMode && view === "2d" && live ? (
                <div
                  className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-80px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-full border px-3 py-1 text-[11.5px] font-medium"
                  style={{ ...lineColor, backgroundColor: "color-mix(in srgb, var(--panel-bg) 88%, transparent)", color: "var(--text-main)" }}
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
              {/* Close shape, while a Custom outline's being drawn: by the drawing's bottom left (the toolbar stays put). */}
              {drawing && !readOnly && view === "2d" ? (
                <button
                  type="button"
                  disabled={!canClose}
                  onClick={closeOutline}
                  onPointerDown={(event) => event.stopPropagation()}
                  className={`${toolOnClass} absolute bottom-3 left-3 z-10`}
                  style={glassShineStyle("var(--brand)")}
                  title="Join the last point back to the first"
                >
                  <Check size={15} strokeWidth={2.4} />
                  Close shape
                </button>
              ) : null}
              {/* A change that would make the outline cross itself (not made), or an outline that does (Save's off). */}
              {message && view === "2d" ? (
                <div
                  key={notice && !dragCrosses && !crosses ? notice.id : "crossing"}
                  role="status"
                  aria-live="polite"
                  className="pointer-events-none absolute left-1/2 top-3 z-20 max-w-[calc(100%-232px)] -translate-x-1/2 truncate rounded-full border px-3 py-1 text-[12px] font-medium max-sm:top-14 max-sm:max-w-[calc(100%-24px)]"
                  style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
                >
                  {message}
                </div>
              ) : null}
            </div>
            {/* The status bar: what the tool does, on the left; on the right, where the pointer is and the line being drawn's
                length and angle. */}
            <div className="flex min-h-[22px] items-center justify-between gap-3 text-[11.5px] font-medium" style={mainText} aria-live="polite">
              <p className="min-w-0 truncate">{hint}</p>
              <p className="flex shrink-0 items-center gap-3 tabular-nums">
                {boxTo && boxTo.length > 0 ? <span>{`L ${formatShapeMm(boxTo.length)}  ∠ ${formatShapeMm(boxTo.angle)}°`}</span> : null}
                {view === "2d" ? <span ref={statusAtRef} /> : null}
              </p>
            </div>
          </div>

          <div className="md:glass-scroll md:col-start-2 md:row-start-1 md:min-h-0 md:overflow-y-auto md:border-l" style={lineColor}>
            {/* What it is — and, a cabinet, how tall (its shelves are on the Piece's Quantity row). */}
            {baseOptions?.length ? (
              <section className={sectionClass} style={lineColor} aria-label="What is it?">
                <p className={headingClass} style={mainText}>
                  What is it?
                </p>
                <GlassDropdown
                  value={base?.partType ?? ""}
                  options={baseDropdownOptions}
                  onChange={chooseBase}
                  placeholder="Choose…"
                  ariaLabel="What is it?"
                  disabled={readOnly}
                  menuMinWidth={200}
                  triggerClassName={`${glassFieldClass} justify-between`}
                />
                {cabinetMode ? (
                  <div className="grid gap-2.5">
                    <label className="flex items-center justify-between gap-3 text-[12px] font-medium" style={mainText}>
                      Height
                      {/* (Its "mm" inside the box.) */}
                      <span className="relative inline-flex w-[100px] items-center">
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
                          className={`${glassFieldClass} w-full! pl-2 pr-8 text-center`}
                        />
                        <span aria-hidden="true" className="pointer-events-none absolute right-2.5 text-[12px] font-medium" style={mainText}>
                          mm
                        </span>
                      </span>
                    </label>
                  </div>
                ) : null}
              </section>
            ) : null}

            {/* Its row's own fields — those its cutlist shows. (Greyed out until what it is is picked, above.) */}
            {showPiece ? (
              <section className={sectionClass} style={lineColor} aria-label="Piece">
                <p className={headingClass} style={mainText}>
                  Piece
                </p>
                {needsBase ? (
                  <p className="-mt-1 text-[12px] font-medium" style={mainText}>
                    Pick what it is first.
                  </p>
                ) : null}
                <fieldset disabled={needsBase} className={`m-0 grid min-w-0 gap-3 border-0 p-0 transition-opacity ${needsBase ? "pointer-events-none opacity-40" : ""}`}>
                {shows("name") ? (
                  <label className={fieldClass} style={mainText}>
                    <span>
                      Part name
                      {needed(missing.name)}
                    </span>
                    <input
                      value={fields.name}
                      readOnly={readOnly}
                      onChange={(event) => setField("name", event.target.value)}
                      placeholder="Part name"
                      aria-invalid={missing.name || undefined}
                      className={glassFieldClass}
                    />
                  </label>
                ) : null}
                {shows("board") ? (
                  <div className={fieldClass} style={mainText}>
                    <span>
                      Board
                      {needed(missing.board)}
                    </span>
                    {renderBoardPicker ? (
                      <div data-shape-editor-board="true">
                        {renderBoardPicker({ value: fields.board, disabled: readOnly, onChange: (value) => setField("board", value) })}
                      </div>
                    ) : (
                      <GlassDropdown
                        value={fields.board}
                        options={boardDropdownOptions}
                        onChange={(value) => setField("board", value)}
                        placeholder="Choose a board"
                        ariaLabel="Board"
                        disabled={readOnly}
                        menuMinWidth={220}
                        triggerClassName={`${glassFieldClass} justify-between`}
                      />
                    )}
                  </div>
                ) : null}
                {cabinetMode ? (
                  <>
                    {/* A cabinet: its count and its shelves side by side (the shelves even with Quantity hidden). */}
                    <div className="flex items-start gap-2">
                      {shows("quantity") ? (
                        <label className={`${fieldClass} w-[86px] shrink-0 justify-items-stretch`} style={mainText}>
                          <span className="block w-full whitespace-nowrap text-center">
                            Qty
                            {needed(missing.quantity)}
                          </span>
                          <input
                            value={fields.quantity}
                            readOnly={readOnly}
                            inputMode="numeric"
                            onChange={(event) => setField("quantity", event.target.value.replace(/\D/g, "").slice(0, 5))}
                            placeholder="0"
                            aria-invalid={missing.quantity || undefined}
                            aria-label="Quantity"
                            className={`${glassFieldClass} w-full! text-center`}
                          />
                        </label>
                      ) : null}
                      {(
                        [
                          { key: "fixedShelves", label: "Fixed shelves", short: "Fixed shelves" },
                          { key: "adjustableShelves", label: "Adjustable shelves", short: "Adj. shelves" },
                        ] as const
                      ).map((counter) => (
                        <div key={counter.key} className={`${fieldClass} w-[86px] shrink-0 justify-items-stretch`} style={mainText}>
                          <span className="block w-full whitespace-nowrap text-center" title={counter.label}>
                            {counter.short}
                          </span>
                          <div className="cs-glass-field inline-flex h-9 w-full items-center justify-between rounded-[11px] border">
                            <button
                              type="button"
                              aria-label={`One fewer ${counter.label.toLowerCase()}`}
                              disabled={readOnly || cabinet[counter.key] <= 0}
                              onClick={() => stepShelves(counter.key, -1)}
                              className="inline-flex h-9 w-6 shrink-0 items-center justify-center rounded-[11px] text-[var(--text-main)] transition hover:brightness-90 disabled:opacity-35"
                            >
                              <Minus size={11} />
                            </button>
                            <span className="min-w-0 flex-1 text-center text-[12.5px] font-medium" style={mainText}>
                              {cabinet[counter.key]}
                            </span>
                            <button
                              type="button"
                              aria-label={`One more ${counter.label.toLowerCase().replace(/s$/, "")}`}
                              disabled={readOnly || cabinet[counter.key] >= 20}
                              onClick={() => stepShelves(counter.key, 1)}
                              className="inline-flex h-9 w-6 shrink-0 items-center justify-center rounded-[11px] text-[var(--text-main)] transition hover:brightness-90 disabled:opacity-35"
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {showGrain ? (
                      <div className={fieldClass} style={mainText}>
                        Grain
                        <GrainToggle choices={grainChoices} index={grainIndex} disabled={readOnly} onChange={(axis) => setField("grain", axis)} />
                      </div>
                    ) : null}
                  </>
                ) : shows("quantity") || showGrain ? (
                  <div className="flex items-start gap-3">
                    {shows("quantity") ? (
                      <label className={`${fieldClass} w-[96px] shrink-0`} style={mainText}>
                        <span className="whitespace-nowrap">
                          Quantity
                          {needed(missing.quantity)}
                        </span>
                        <input
                          value={fields.quantity}
                          readOnly={readOnly}
                          inputMode="numeric"
                          onChange={(event) => setField("quantity", event.target.value.replace(/\D/g, "").slice(0, 5))}
                          placeholder="0"
                          aria-invalid={missing.quantity || undefined}
                          className={`${glassFieldClass} text-center`}
                        />
                      </label>
                    ) : null}
                    {showGrain ? (
                      <div className={`${fieldClass} min-w-0 flex-1`} style={mainText}>
                        Grain
                        <GrainToggle choices={grainChoices} index={grainIndex} disabled={readOnly} onChange={(axis) => setField("grain", axis)} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {shows("information") ? (
                  <div className={fieldClass} style={mainText}>
                    Information
                    {/* A line each, as the cutlist rows have it: the first's + adds a line, each other's X takes it off. */}
                    {infoLines.map((line, index) => (
                      <div key={index} className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => (index === 0 ? setInfoLines([...infoLines, ""]) : setInfoLines(infoLines.filter((_, i) => i !== index)))}
                          aria-label={index === 0 ? "Add a line" : "Take this line off"}
                          className="glass-shine inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-white hover:brightness-95 disabled:opacity-55"
                          style={glassShineStyle(index === 0 ? "#16A34A" : "var(--danger)")}
                        >
                          {index === 0 ? <Plus size={16} strokeWidth={2.8} /> : <X size={15} strokeWidth={2.8} />}
                        </button>
                        <input
                          value={line}
                          readOnly={readOnly}
                          onChange={(event) => setInfoLines(infoLines.map((item, i) => (i === index ? event.target.value : item)))}
                          placeholder="Information"
                          aria-label={`Information, line ${index + 1}`}
                          className={glassFieldClass}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
                </fieldset>
              </section>
            ) : null}

            {/* A cabinet's parts, worked out as it's drawn (hovered: picked out on the drawing). */}
            {cabinetMode ? (
              <section className={`${sectionClass} ${partsOpen ? "" : "gap-0!"}`} style={lineColor} aria-label="Cabinet parts">
                <button
                  type="button"
                  onClick={togglePartsOpen}
                  aria-expanded={partsOpen}
                  aria-controls="shape-editor-cabinet-parts"
                  className="-mx-1 flex items-center gap-2 rounded-[8px] px-1 py-0.5 text-left transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
                >
                  <span className={headingClass} style={mainText}>
                    Cabinet parts
                  </span>
                  <span
                    className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border px-1.5 text-[10.5px] font-medium"
                    style={{ ...lineColor, ...mainText }}
                    title={`${parts.reduce((sum, item) => sum + item.quantity, 0)} parts`}
                  >
                    {parts.reduce((sum, item) => sum + item.quantity, 0)}
                  </span>
                  <ChevronDown
                    size={15}
                    aria-hidden="true"
                    className={`ml-auto shrink-0 transition-transform duration-200 ${partsOpen ? "rotate-180" : ""}`}
                    style={mainText}
                  />
                </button>
                {/* (Its height eased open and shut; shut, it can't be pointed at or tabbed into.) */}
                <div
                  id="shape-editor-cabinet-parts"
                  className={`grid transition-[grid-template-rows] duration-200 ease-out ${partsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                  inert={!partsOpen}
                >
                <div className="min-h-0 overflow-hidden">
                <div className="overflow-hidden rounded-[12px] border" style={lineColor} onPointerLeave={() => setHoverPart(null)}>
                  <div className="flex items-center gap-2.5 border-b px-3 py-1.5 text-[11px] font-medium" style={{ ...lineColor, ...mainText }}>
                    <span className="min-w-0 flex-1">Part · size (H × W)</span>
                    <span className="w-[74px] shrink-0 text-center">Clashing</span>
                    <span className="w-[28px] shrink-0 text-right">Qty</span>
                  </div>
                  {parts.length ? (
                    parts.map((item) => {
                      const swatch = item.name === "Back" ? CABINET_EDGE_ROLE_COLORS.back : item.name === "End" ? CABINET_EDGE_ROLE_COLORS.end : null;
                      return (
                        <div
                          key={item.key}
                          className="flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] font-medium transition-colors"
                          style={{
                            color: "var(--text-main)",
                            backgroundColor: hoverPart === item.key ? "color-mix(in srgb, var(--brand) 10%, transparent)" : undefined,
                          }}
                          onPointerEnter={() => setHoverPart(item.key)}
                        >
                          {item.shape ? (
                            <CutlistShapeThumbnail shape={item.shape} color={wash} width={26} height={18} />
                          ) : (
                            <span aria-hidden="true" className="inline-flex h-[18px] w-[26px] shrink-0 items-center justify-center">
                              <span className="h-[4px] w-4 rounded-full" style={{ backgroundColor: swatch ?? "var(--text-muted)" }} />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{item.name}</span>
                            {item.problem ? (
                              <span className="block truncate text-[11.5px]" style={{ color: "var(--danger-strong)" }}>
                                {item.problem}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px]">
                                {formatShapeMm(item.height ?? 0)} × {formatShapeMm(item.width ?? 0)}
                                {/* (A panel mitred at a corner that isn't square — a very sharp one in red.) */}
                                {item.note ? (
                                  <span
                                    className="shrink-0 rounded-full border px-1.5 text-[10.5px] font-medium"
                                    style={{
                                      ...lineColor,
                                      color: item.mitres?.some((mitre) => mitre.sharp) ? "var(--danger-strong)" : "var(--text-main)",
                                    }}
                                    title={item.note}
                                  >
                                    {item.note.replace(/^Mitres? /, "mitre ")}
                                  </span>
                                ) : null}
                              </span>
                            )}
                          </span>
                          {/* (Its Clashing as its row in the cutlist has it: 1L / 2L / 1S / 2S, a shaped part's banding.) */}
                          <span className="w-[74px] shrink-0 text-center text-[11.5px] leading-tight">{customCabinetPartClashingText(item)}</span>
                          <span className="w-[28px] shrink-0 text-right">×{item.quantity}</span>
                        </div>
                      );
                    })
                  ) : (
                    <p className="px-3 py-2 text-[12px] font-medium" style={mainText}>
                      {drawing ? "Close the outline to work out its parts." : "Nothing to make yet."}
                    </p>
                  )}
                </div>
                </div>
                </div>
              </section>
            ) : null}

            {/* Its sizes. */}
            <section className={sectionClass} style={lineColor} aria-label="Sizes">
              <p className={headingClass} style={mainText}>
                Sizes
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {summary.map((item) => (
                  <div key={item.label} className="min-w-0">
                    <p className="text-[11px] font-medium" style={mainText}>
                      {item.label}
                    </p>
                    <p className="truncate text-[14px] font-medium" style={mainText}>
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        {!readOnly ? (
          <div className="shrink-0 border-t px-4 py-3 md:col-start-2 md:row-start-2 md:border-l" style={lineColor}>
            <button
              type="button"
              disabled={saveBlocked}
              title={crosses ? CROSSING_MESSAGE : fieldsMissing ? "Its part name, board and quantity are needed" : undefined}
              onClick={save}
              className="glass-shine inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border px-6 text-[14px] font-medium text-white transition hover:brightness-95 disabled:opacity-50"
              style={glassShineStyle("var(--brand)")}
            >
              <Check size={15} strokeWidth={2.6} />
              {isNew ? "Add piece" : "Save piece"}
            </button>
          </div>
        ) : null}
      </div>

      {menuEdge ? (
        <ShapeEdgeMenu
          key={`${menuEdgeIndex}:${menuGuide}:${menuEdge.x}:${menuEdge.y}`}
          x={menuEdge.x}
          y={menuEdge.y}
          role={cabinetMode && menuEdgeIndex !== null ? roles[menuEdgeIndex] : undefined}
          canRunThrough={menuEdgeIndex !== null && roles[menuEdgeIndex] === "back" && edgeMeetings.length > 0}
          runsThrough={edgeMeetings.length > 0 && edgeMeetings.every((meeting) => meeting.through === menuEdgeIndex)}
          onPick={(role) => {
            if (menuEdgeIndex !== null) pickEdgeRole(menuEdgeIndex, role);
          }}
          onRunThrough={() => {
            if (menuEdgeIndex !== null) runBackThrough(menuEdgeIndex);
          }}
          deleteLine={
            menuGuide !== null
              ? { label: "Delete line", hint: "This piece of the line, crossing to crossing", onSelect: () => deleteGuidePiece(menuGuide, menuAt) }
              : guides.length && menuEdgeIndex !== null && menuAt
                ? {
                    label: "Delete line",
                    hint: "Cut away what the lines close off here",
                    disabled: menuCut && !menuCut.ok ? cutRefusal(menuCut.reason) : undefined,
                    onSelect: () => deleteLinePiece(menuEdgeIndex, menuAt),
                  }
                : undefined
          }
          onDeleteHover={setDeleteHover}
          onClose={() => {
            setEdgeMenu(null);
            setDeleteHover(false);
          }}
        />
      ) : null}
      {/* Closed with changes not saved: Are you sure? — over the whole pop-up. */}
      {confirmClose ? (
        <EditorConfirm
          title="Are you sure?"
          text={isNew ? "This piece hasn't been added yet — the drawing will be lost." : "Your changes haven't been saved — they'll be lost."}
          cancelLabel="Keep editing"
          onCancel={() => setConfirmClose(false)}
          actions={[
            {
              label: "Discard",
              tone: "danger",
              onClick: () => {
                setConfirmClose(false);
                onClose();
              },
            },
            // (Saved as Save would — not while it can't be: an outline not closed, crossing itself, a field missing.)
            {
              label: "Save & close",
              tone: "primary",
              disabled: !live || drawing || crosses || fieldsMissing,
              onClick: () => {
                setConfirmClose(false);
                save();
              },
            },
          ]}
        />
      ) : null}
      {/* Clear, with the drawing changed: asked first. */}
      {confirmClear ? (
        <EditorConfirm
          title="Clear the drawing?"
          text="Everything drawn will be removed."
          cancelLabel="Cancel"
          onCancel={() => setConfirmClear(false)}
          actions={[
            {
              label: "Clear",
              tone: "danger",
              onClick: () => {
                setConfirmClear(false);
                clearDrawing();
              },
            },
          ]}
        />
      ) : null}
    </>
  );
}

// A group of the toolbar's tools: icon buttons in one glass pill, a thin line between each — the one on (a tool in use,
// a toggle on) in the brand blue; one that doesn't apply now greyed. Each one's tooltip its name and its key.
function ToolGroup({
  label,
  tools,
}: {
  label: string;
  tools: Array<{ key: string; name: string; keys: string; icon: ReactNode; on?: boolean; disabled?: boolean; onClick: () => void }>;
}) {
  if (!tools.length) return null;
  return (
    <div role="group" aria-label={label} className="glass-shine glass-shine-neutral inline-flex h-9 shrink-0 items-stretch overflow-hidden rounded-full border">
      {tools.map((tool, i) => (
        <span key={tool.key} className="flex items-stretch">
          {i > 0 ? <span aria-hidden="true" className="my-2 w-px" style={{ backgroundColor: "var(--glass-border)" }} /> : null}
          <button
            type="button"
            aria-pressed={tool.on === undefined ? undefined : tool.on}
            aria-label={tool.name}
            title={tool.keys ? `${tool.name} (${tool.keys})` : tool.name}
            disabled={tool.disabled}
            onClick={tool.onClick}
            className={`inline-flex w-[34px] items-center justify-center transition disabled:opacity-35 ${tool.on ? "text-white" : "text-[var(--text-main)] hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)]"}`}
            style={tool.on ? { backgroundImage: "var(--brand-gradient)" } : undefined}
          >
            {tool.icon}
          </button>
        </span>
      ))}
    </div>
  );
}

// The keys, listed — a small glass panel under the toolbar's ?, closed by a press anywhere else (or Escape, in the
// editor's keys).
function ShortcutsPopover({ list, onClose }: { list: Array<{ keys: string; what: string }>; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const close = useEffectEvent(() => onClose());
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[aria-label="Keyboard shortcuts"]')) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);
  return (
    <div className="relative z-30 h-0">
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="absolute right-0 top-1 w-[min(300px,calc(100vw-48px))] rounded-[14px] border p-3 shadow-[var(--shadow-md)]"
        style={{ ...GLASS_MENU_STYLE, position: "absolute" }}
      >
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
          Keyboard shortcuts
        </p>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
          {list.map((item) => (
            <span key={item.keys} className="contents">
              <span className="whitespace-nowrap rounded-[6px] border px-1.5 text-center" style={{ borderColor: "var(--glass-border)" }}>
                {item.keys}
              </span>
              <span className="truncate">{item.what}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// The editor's own "Are you sure?" — over the whole pop-up (its backdrop, or its first button, cancels; Escape does too,
// in the editor's keys): a title, a line saying what'll happen, and what can be done — a danger one in red, the main one
// in the brand's glass.
function EditorConfirm({
  title,
  text,
  cancelLabel,
  onCancel,
  actions,
}: {
  title: string;
  text: string;
  cancelLabel: string;
  onCancel: () => void;
  actions: Array<{ label: string; tone: "danger" | "primary"; disabled?: boolean; onClick: () => void }>;
}) {
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center p-4" data-swipe-close="off">
      <button type="button" aria-label={cancelLabel} onClick={onCancel} className="glass-modal-backdrop absolute inset-0" />
      <div role="alertdialog" aria-modal="true" aria-label={title} data-phone-keep-box="true" className="glass-modal-panel relative w-[min(380px,100%)] p-5">
        <p className="text-[15px] font-medium" style={{ color: "var(--text-main)" }}>
          {title}
        </p>
        <p className="mt-1.5 text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
          {text}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="glass-shine glass-shine-neutral inline-flex h-9 items-center rounded-full border px-4 text-[13px] font-medium text-[var(--text-main)] transition hover:brightness-[0.97]"
          >
            {cancelLabel}
          </button>
          {actions.map((action) =>
            action.tone === "danger" ? (
              <button
                key={action.label}
                type="button"
                disabled={action.disabled}
                onClick={action.onClick}
                className="inline-flex h-9 items-center rounded-full border px-4 text-[13px] font-medium transition hover:brightness-95 disabled:opacity-50"
                style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
              >
                {action.label}
              </button>
            ) : (
              <button
                key={action.label}
                type="button"
                disabled={action.disabled}
                onClick={action.onClick}
                className="glass-shine inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium text-white transition hover:brightness-95 disabled:opacity-50"
                style={glassShineStyle("var(--brand)")}
              >
                <Check size={14} strokeWidth={2.6} />
                {action.label}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

// Its grain as its cutlist rows' Grain toggle has it (GrainDimensionToggle, on the project page): a segment for each
// way it can run, with its size, and a pill sliding to the one it runs — a click anywhere on it moves it on to the next.
function GrainToggle({
  choices,
  index,
  disabled,
  onChange,
}: {
  choices: Array<{ axis: Exclude<CutlistShapeGrainAxis, "">; size: number }>;
  index: number;
  disabled?: boolean;
  onChange: (axis: Exclude<CutlistShapeGrainAxis, "">) => void;
}) {
  if (!choices.length) return null;
  const width = 100 / choices.length;
  const words = { H: "height", W: "width", D: "depth" } as const;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Grain along the ${words[choices[index].axis]} — click for the next way`}
      onClick={() => onChange(choices[(index + 1) % choices.length].axis)}
      className="relative inline-flex h-9 w-full items-stretch overflow-hidden rounded-full border disabled:opacity-60"
      style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 rounded-full"
        style={{
          left: `${index * width}%`,
          width: `${width}%`,
          backgroundImage: "var(--brand-gradient)",
          transition: "left 180ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      />
      {choices.map((choice, i) => (
        <span
          key={choice.axis}
          className="relative z-[1] flex items-center justify-center gap-1 whitespace-nowrap text-[11.5px] font-medium"
          style={{ width: `${width}%`, color: i === index ? "#FFFFFF" : "var(--text-main)" }}
        >
          {choice.axis}
          <span>{formatShapeMm(choice.size)}</span>
        </span>
      ))}
    </button>
  );
}

// An edge's menu — the edge right-clicked, or held on a touch screen. A cabinet's: what it is (Doors, Back or End, each
// in its colour on the drawing, the one it is ticked) and, a back that meets another back, Run this back through. Any
// shape's, with construction lines drawn: Delete line (the piece cut away up to the line; on a construction line, the
// line). The app's glass menu, as a project's quick actions menu has it (components/project-quick-actions-menu.tsx):
// at the pointer, kept on the screen, closed by a press anywhere else (that press doing nothing more), a scroll, or
// Escape (the editor's keys).
const EDGE_MENU_ROW_CLASS = `${GLASS_MENU_ROW_CLASS} h-8 max-md:h-11`;
const EDGE_MENU_MARGIN_PX = 8;
function ShapeEdgeMenu({
  x,
  y,
  role,
  canRunThrough,
  runsThrough,
  onPick,
  onRunThrough,
  deleteLine,
  onDeleteHover,
  onClose,
}: {
  x: number;
  y: number;
  // A cabinet's edge: what it is now (undefined — not a cabinet's edge: no roles).
  role: CabinetEdgeRole | undefined;
  canRunThrough: boolean;
  runsThrough: boolean;
  onPick: (role: CabinetEdgeRole) => void;
  onRunThrough: () => void;
  // (`disabled`: why it can't be — shown in its row, which does nothing.)
  deleteLine?: { label: string; hint: string; disabled?: string; onSelect: () => void };
  // Delete line pointed at (or focused), and let go: what it'd take shown on the drawing.
  onDeleteHover?: (on: boolean) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  // At the pointer, kept on the screen — squeezing out of it as it opens (.glass-menu-squeeze).
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const viewport = window.visualViewport;
    const viewLeft = viewport?.offsetLeft ?? 0;
    const viewTop = viewport?.offsetTop ?? 0;
    const viewWidth = viewport?.width ?? window.innerWidth;
    const viewHeight = viewport?.height ?? window.innerHeight;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.max(viewLeft + EDGE_MENU_MARGIN_PX, Math.min(x, viewLeft + viewWidth - EDGE_MENU_MARGIN_PX - width));
    const top = Math.max(viewTop + EDGE_MENU_MARGIN_PX, Math.min(y, viewTop + viewHeight - EDGE_MENU_MARGIN_PX - height));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.transformOrigin = `${Math.round(Math.min(width, Math.max(0, x - left)))}px ${Math.round(Math.min(height, Math.max(0, y - top)))}px`;
  }, [x, y]);
  const close = useEffectEvent(() => onClose());
  useEffect(() => {
    const inMenu = (target: EventTarget | null) => target instanceof Node && Boolean(menuRef.current?.contains(target));
    const onPointerDown = (event: PointerEvent) => {
      if (inMenu(event.target)) return;
      close();
      if (event.button === 0) swallowNextClick();
    };
    const onScroll = (event: Event) => {
      if (!inMenu(event.target)) close();
    };
    const onAway = () => close();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onAway);
    window.addEventListener("blur", onAway);
    // (The keyboard: into it, on what the edge is.)
    const frame = requestAnimationFrame(() => {
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("button") ?? []);
      (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onAway);
      window.removeEventListener("blur", onAway);
    };
  }, []);
  // Up and down between its rows.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("button") ?? []);
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (at + 1) % items.length : at <= 0 ? items.length - 1 : at - 1;
    items[next]?.focus();
  };
  if (typeof document === "undefined") return null;
  const pickedStyle = { backgroundColor: "color-mix(in srgb, var(--brand) 10%, transparent)" };
  const tick = <Check size={14} className="ml-auto shrink-0" style={{ color: "var(--brand)" }} />;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="This edge"
      className={`${GLASS_MENU_CLASS} min-w-[190px]`}
      style={{ ...GLASS_MENU_STYLE, left: x, top: y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {(role ? CABINET_EDGE_ROLES : []).map((option) => {
        const picked = option === role;
        return (
          <button
            key={option}
            type="button"
            role="menuitemradio"
            aria-checked={picked}
            onClick={() => onPick(option)}
            className={EDGE_MENU_ROW_CLASS}
            style={{ color: "var(--text-main)", ...(picked ? pickedStyle : null) }}
          >
            <span aria-hidden="true" className="h-[4px] w-4 shrink-0 rounded-full" style={{ backgroundColor: CABINET_EDGE_ROLE_COLORS[option] }} />
            <span className="min-w-0 flex-1 truncate">{CABINET_EDGE_ROLE_LABELS[option]}</span>
            {picked ? tick : null}
          </button>
        );
      })}
      {canRunThrough ? (
        <>
          <div role="separator" className="mx-2 my-1 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={runsThrough}
            onClick={onRunThrough}
            className={EDGE_MENU_ROW_CLASS}
            style={{ color: "var(--text-main)", ...(runsThrough ? pickedStyle : null) }}
          >
            <ArrowRightLeft size={14} className="shrink-0" style={{ color: CABINET_EDGE_ROLE_COLORS.back }} />
            <span className="min-w-0 flex-1 truncate">Run this back through</span>
            {runsThrough ? tick : null}
          </button>
        </>
      ) : null}
      {deleteLine ? (
        <>
          {role ? <div role="separator" className="mx-2 my-1 h-px" style={{ backgroundColor: "var(--glass-border)" }} /> : null}
          <button
            type="button"
            role="menuitem"
            disabled={Boolean(deleteLine.disabled)}
            aria-disabled={Boolean(deleteLine.disabled) || undefined}
            onClick={deleteLine.onSelect}
            onPointerEnter={() => onDeleteHover?.(true)}
            onPointerLeave={() => onDeleteHover?.(false)}
            onFocus={() => onDeleteHover?.(true)}
            onBlur={() => onDeleteHover?.(false)}
            className={EDGE_MENU_ROW_CLASS}
            style={{ color: "var(--danger)", opacity: deleteLine.disabled ? 0.55 : 1, cursor: deleteLine.disabled ? "not-allowed" : undefined }}
            title={deleteLine.disabled ?? deleteLine.hint}
          >
            {deleteLine.hint.startsWith("This") ? <Trash2 size={14} className="shrink-0" /> : <Scissors size={14} className="shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{deleteLine.label}</span>
            {deleteLine.disabled ? (
              <span className="shrink-0 text-[11px] font-medium" style={{ color: "var(--text-main)" }}>
                {deleteLine.disabled}
              </span>
            ) : null}
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
