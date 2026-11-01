"use client";

import { useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { Pencil } from "lucide-react";
import {
  formatShapeMm,
  isCabinetShape,
  shapeBandingSummary,
  shapeChainPath,
  shapeGeometry,
  shapeOuterSize,
  shapeOutlinePath,
  type CutlistShape,
  type ShapePoint,
} from "@/lib/cutlist-shape";
import { shapeDrawingSvg } from "@/lib/cutlist-shape-render";
import { shapeDxfFileName, shapeToDxf } from "@/lib/cutlist-shape-dxf";
import {
  CABINET_EDGE_ROLE_COLORS,
  cabinetEdgeRoles,
  cabinetPlanSvg,
  cabinetRoleChains,
  cachedCustomCabinetModel,
  cachedCustomCabinetParts,
  customCabinetBandingSummary,
  customCabinetPartLines,
  customCabinetSize,
  customCabinetSizeText,
  type CabinetPart,
} from "@/lib/cutlist-cabinet-shape";
import { CutlistShapeThumbnail } from "@/components/cutlist-shape-thumbnail";
import { CutlistCabinet3d } from "@/components/cutlist-cabinet-3d";
import { glassShineStyle } from "@/lib/glass-shine";

// A Custom cutlist row's piece, shown in the cutlists (Production and Initial Measure, desktop and phone, and the CNC
// Cutlist): its drawing with its sizes (lib/cutlist-shape-render.ts' shapeDrawingSvg — on white, as it prints), a small
// one with its outer size under it for its row, and its DXF to download (lib/cutlist-shape-dxf.ts).
//
// A custom cabinet (isCabinetShape — its drawing its top view, lib/cutlist-cabinet-shape.ts): its top view with its
// backs and ends drawn a board thick (`boardThicknessMm`, 18 unless given), its Height × Width × Depth under the small
// one; opened, how it's built — its top view with dimensions and a small 3D view (its parts: the page's sub-rows) — and
// its shaped parts' DXFs.

// The board thickness a cabinet's drawn and worked out at when none's given.
const DEFAULT_BOARD_MM = 18;
const boardMmOf = (value: number | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BOARD_MM;
};

// The piece as a DXF file, downloaded — named after the part.
export function downloadCutlistShapeDxf(shape: CutlistShape, name: string): void {
  if (typeof document === "undefined") return;
  saveBlob(new Blob([shapeToDxf(shape, { name })], { type: "application/dxf" }), shapeDxfFileName(name));
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// A custom cabinet's shaped parts (its top, bottom and shelves) as DXFs, one file each in a zip named after it — or, if
// a zip can't be made, its top's DXF on its own.
export async function downloadCustomCabinetDxfs(shape: CutlistShape, boardThicknessMm: number | undefined, name: string): Promise<void> {
  if (typeof document === "undefined") return;
  const cabinetName = String(name || "Cabinet").trim() || "Cabinet";
  const lines = customCabinetPartLines(cachedCustomCabinetParts(shape, boardMmOf(boardThicknessMm))).filter((line) => line.part.kind === "shape" && line.part.shape);
  if (!lines.length) return;
  try {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const used = new Set<string>();
    for (const line of lines) {
      const partName = `${cabinetName} - ${line.label}`;
      let fileName = shapeDxfFileName(partName);
      for (let n = 2; used.has(fileName.toLowerCase()); n += 1) fileName = shapeDxfFileName(`${partName} ${n}`);
      used.add(fileName.toLowerCase());
      zip.file(fileName, shapeToDxf(line.part.shape as CutlistShape, { name: partName }));
    }
    const blob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
    saveBlob(blob, shapeDxfFileName(cabinetName).replace(/\.dxf$/i, ".zip"));
  } catch {
    const top = lines.find((line) => line.part.name === "Top") ?? lines[0];
    downloadCutlistShapeDxf(top.part.shape as CutlistShape, `${cabinetName} - ${top.label}`);
  }
}

// Its outer size in words, Height then Width (as the cutlist's columns): "H 600 × W 900". A custom cabinet's: its
// Height × Width × Depth.
export function cutlistShapeSizeText(shape: CutlistShape): string {
  if (isCabinetShape(shape)) return customCabinetSizeText(shape);
  const size = shapeOuterSize(shape);
  return `H ${formatShapeMm(size.height)} × W ${formatShapeMm(size.width)}`;
}

// Its banding in words, for its Clashing: what's banded on it — a custom cabinet's, on its shaped parts.
export function cutlistShapeBandingText(shape: CutlistShape, boardThicknessMm?: number): string {
  if (isCabinetShape(shape)) return customCabinetBandingSummary(cachedCustomCabinetParts(shape, boardMmOf(boardThicknessMm)));
  return shapeBandingSummary(shape);
}

// The drawing: its outline, banding and arrows at it, dimensions and R labels — on a white card (it's drawn for paper),
// as big as it's given and never wider than its box.
export function CutlistShapeDrawing({
  shape,
  width = 560,
  height = 280,
  fontSize = 11,
  className = "",
}: {
  shape: CutlistShape;
  width?: number;
  height?: number;
  fontSize?: number;
  className?: string;
}) {
  const svg = useMemo(() => shapeDrawingSvg(shape, { width, height, fontSize }), [shape, width, height, fontSize]);
  return (
    <div
      role="img"
      aria-label={`Shape drawing, ${cutlistShapeSizeText(shape)}`}
      className={`overflow-hidden rounded-[12px] border bg-white [&>svg]:block [&>svg]:h-auto [&>svg]:max-w-full ${className}`}
      style={{ borderColor: "#E2E8F0", maxWidth: width }}
      // (Our own drawing's markup — lib/cutlist-shape-render.ts escapes everything in it.)
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// A custom cabinet's top view: its outline and dimensions, its backs and ends a board thick, its doors edges — on a white
// card, as the flat piece's drawing is.
export function CutlistCabinetPlanDrawing({
  shape,
  boardThicknessMm,
  width = 560,
  height = 280,
  fontSize = 11,
  className = "",
}: {
  shape: CutlistShape;
  boardThicknessMm?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  className?: string;
}) {
  const thicknessMm = boardMmOf(boardThicknessMm);
  const svg = useMemo(() => cabinetPlanSvg(shape, { thicknessMm, width, height, fontSize }), [shape, thicknessMm, width, height, fontSize]);
  return (
    <div
      role="img"
      aria-label={`Cabinet top view, ${customCabinetSizeText(shape)}`}
      className={`overflow-hidden rounded-[12px] border bg-white [&>svg]:block [&>svg]:h-auto [&>svg]:max-w-full ${className}`}
      style={{ borderColor: "#E2E8F0", maxWidth: width }}
      // (Our own drawing's markup — lib/cutlist-shape-render.ts escapes everything in it.)
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// A custom cabinet's top view, small (its row's Shape cell): its outline in a wash of its part type's colour, its backs
// and ends drawn in a board thick, its doors edges in the doors' colour. Fitted to the box it's given.
export function CutlistCabinetPlanThumbnail({
  shape,
  boardThicknessMm,
  color,
  width = 64,
  height = 30,
  strokeColor = "currentColor",
  className = "",
  title,
}: {
  shape: CutlistShape;
  boardThicknessMm?: number;
  color: string;
  width?: number;
  height?: number;
  strokeColor?: string;
  className?: string;
  title?: string;
}) {
  const thicknessMm = boardMmOf(boardThicknessMm);
  const geometry = useMemo(() => shapeGeometry(shape), [shape]);
  const model = useMemo(() => cachedCustomCabinetModel(shape, thicknessMm), [shape, thicknessMm]);
  const doorChains = useMemo(
    () => (geometry.valid ? cabinetRoleChains(geometry, cabinetEdgeRoles(shape)).filter((item) => item.role === "doors") : []),
    [geometry, shape],
  );
  if (!geometry.valid) return <svg width={width} height={height} className={className} aria-hidden="true" />;
  const pad = 3;
  const b = geometry.bounds;
  const scale = Math.min((width - 2 * pad) / Math.max(b.width, 1), (height - 2 * pad) / Math.max(b.height, 1));
  const ox = (width - b.width * scale) / 2 - b.minX * scale;
  const oy = (height - b.height * scale) / 2 - b.minY * scale;
  const toScreen = (p: ShapePoint): ShapePoint => [ox + p[0] * scale, oy + p[1] * scale];
  const at = (p: ShapePoint) => {
    const s = toScreen(p);
    return `${Math.round(s[0] * 100) / 100},${Math.round(s[1] * 100) / 100}`;
  };
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={`shrink-0 ${className}`} role="img" aria-label={title ?? "Custom cabinet"}>
      {title ? <title>{title}</title> : null}
      <path d={shapeOutlinePath(geometry, toScreen, scale)} fill={color} fillOpacity={0.3} stroke={strokeColor} strokeWidth={1} strokeLinejoin="round" />
      {model.prisms
        .filter((prism) => prism.kind === "back" || prism.kind === "end")
        .map((prism) => (
          <polygon
            key={prism.key}
            points={prism.polygon.map(at).join(" ")}
            fill={CABINET_EDGE_ROLE_COLORS[prism.kind as "back" | "end"]}
            fillOpacity={0.85}
            stroke={strokeColor}
            strokeWidth={0.5}
            strokeLinejoin="round"
          />
        ))}
      {doorChains.map(({ chain }) => (
        <path
          key={`d${chain.edges[0]}`}
          d={shapeChainPath(geometry, chain, toScreen, scale)}
          fill="none"
          stroke={CABINET_EDGE_ROLE_COLORS.doors}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

// A row's Shape cell (in place of Height / Width / Depth): a small drawing of it, its outer size in small text under it
// — the size its grain runs along bold and underlined, as the cutlist's Height and Width are. A custom cabinet's: its
// top view, and its Height × Width × Depth.
export function CutlistShapeSizeCell({
  shape,
  color,
  textColor = "var(--text-main)",
  grainAxis = null,
  thumbWidth = 64,
  thumbHeight = 30,
  strokeColor,
  boardThicknessMm,
}: {
  shape: CutlistShape;
  color: string;
  textColor?: string;
  grainAxis?: "height" | "width" | "depth" | null;
  thumbWidth?: number;
  thumbHeight?: number;
  strokeColor?: string;
  // A custom cabinet's board thickness (mm) — its backs and ends drawn that thick.
  boardThicknessMm?: number;
}) {
  const grained = { fontWeight: 700, textDecoration: "underline" } as const;
  if (isCabinetShape(shape)) {
    const size = customCabinetSize(shape);
    return (
      <span className="inline-flex flex-col items-center gap-0.5 py-0.5">
        <CutlistCabinetPlanThumbnail shape={shape} boardThicknessMm={boardThicknessMm} color={color} width={thumbWidth} height={thumbHeight} strokeColor={strokeColor} title="Custom cabinet" />
        <span className="whitespace-nowrap text-[10px] font-medium leading-none" style={{ color: textColor }}>
          H <span style={grainAxis === "height" ? grained : undefined}>{formatShapeMm(size.height)}</span> × W{" "}
          <span style={grainAxis === "width" ? grained : undefined}>{formatShapeMm(size.width)}</span> × D{" "}
          <span style={grainAxis === "depth" ? grained : undefined}>{formatShapeMm(size.depth)}</span>
        </span>
      </span>
    );
  }
  const size = shapeOuterSize(shape);
  return (
    <span className="inline-flex flex-col items-center gap-0.5 py-0.5">
      <CutlistShapeThumbnail shape={shape} color={color} width={thumbWidth} height={thumbHeight} strokeColor={strokeColor} title="Custom shape" />
      <span className="whitespace-nowrap text-[10px] font-medium leading-none" style={{ color: textColor }}>
        H <span style={grainAxis === "height" ? grained : undefined}>{formatShapeMm(size.height)}</span> × W{" "}
        <span style={grainAxis === "width" ? grained : undefined}>{formatShapeMm(size.width)}</span>
      </span>
    </span>
  );
}

// A part's size in words: a panel's Height × Width; a shaped part's Width × Depth (the box round it, from above).
export function customCabinetPartSizeText(part: CabinetPart): string {
  if (!(Number(part.width) > 0) || !(Number(part.height) > 0)) return "-";
  return part.kind === "panel"
    ? `H ${formatShapeMm(Number(part.height))} × W ${formatShapeMm(Number(part.width))}`
    : `W ${formatShapeMm(Number(part.width))} × D ${formatShapeMm(Number(part.height))}`;
}

// What a row opens to (its drop-down arrow, or its popup on a phone): the drawing big enough to read, with Edit shape (View
// shape, read only) over its top left corner. A custom cabinet's: how it's built (CutlistCabinetDetail).
export function CutlistShapeDetail({
  shape,
  name,
  readOnly,
  onEdit,
  drawingWidth = 560,
  drawingHeight = 280,
  fontSize = 11,
  stacked = false,
  textColor = "var(--text-main)",
  boardThicknessMm,
  doorGapMm,
  color = "#CBD5E1",
  quantity,
}: {
  shape: CutlistShape;
  name: string;
  readOnly: boolean;
  onEdit: (e: ReactMouseEvent<HTMLElement>) => void;
  drawingWidth?: number;
  drawingHeight?: number;
  fontSize?: number;
  // On a phone: the buttons under the drawing, not beside it.
  stacked?: boolean;
  textColor?: string;
  // A custom cabinet's: its board thickness (mm), its part type's colour (its 3D view's), and how many of it the row is —
  // and the gap between its doors where they meet (mm, the project's Vertical gap between doors / panels).
  boardThicknessMm?: number;
  doorGapMm?: number;
  color?: string;
  quantity?: number | string;
}) {
  if (isCabinetShape(shape)) {
    return (
      <CutlistCabinetDetail
        shape={shape}
        name={name}
        readOnly={readOnly}
        onEdit={onEdit}
        drawingWidth={drawingWidth}
        drawingHeight={drawingHeight}
        fontSize={fontSize}
        stacked={stacked}
        textColor={textColor}
        boardThicknessMm={boardThicknessMm}
        doorGapMm={doorGapMm}
        color={color}
        quantity={quantity}
      />
    );
  }
  return (
    <div className="relative">
      <CutlistShapeDrawing shape={shape} width={drawingWidth} height={drawingHeight} fontSize={fontSize} className={stacked ? "mx-auto w-full" : "w-full"} />
      {/* Edit shape, over the drawing's top left corner. */}
      <button
        type="button"
        onClick={onEdit}
        className="glass-shine absolute left-2 top-2 z-[1] inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3.5 text-[12px] font-medium text-white hover:brightness-95"
        style={glassShineStyle("var(--brand)")}
      >
        <Pencil size={13} />
        {readOnly ? "View shape" : "Edit shape"}
      </button>
    </div>
  );
}

// A custom cabinet opened: its top view with its dimensions, Edit shape over its top left corner, and a small 3D view
// (dragged to turn it). Its parts are the cutlist's own sub-rows under it, in the List's columns (the page lays them out).
export function CutlistCabinetDetail({
  shape,
  readOnly,
  onEdit,
  drawingWidth = 560,
  drawingHeight = 280,
  fontSize = 11,
  stacked = false,
  boardThicknessMm,
  doorGapMm,
  color = "#CBD5E1",
}: {
  shape: CutlistShape;
  name: string;
  readOnly: boolean;
  onEdit: (e: ReactMouseEvent<HTMLElement>) => void;
  drawingWidth?: number;
  drawingHeight?: number;
  fontSize?: number;
  stacked?: boolean;
  textColor?: string;
  boardThicknessMm?: number;
  doorGapMm?: number;
  color?: string;
  quantity?: number | string;
}) {
  const thicknessMm = boardMmOf(boardThicknessMm);
  const model = cachedCustomCabinetModel(shape, thicknessMm, doorGapMm);
  const view3d = stacked ? { width: 320, height: 220 } : { width: Math.min(340, Math.round(drawingHeight * 1.15)), height: drawingHeight };
  return (
    <div className="flex flex-col gap-3">
      <div className={`flex gap-3 ${stacked ? "flex-col items-stretch" : "flex-wrap items-stretch"}`}>
        {/* (Its own width, not stretched — the 3D view right beside it.) */}
        <div className={`relative ${stacked ? "w-full" : "min-w-0 shrink"}`} style={stacked ? undefined : { width: drawingWidth, maxWidth: "100%" }}>
          <CutlistCabinetPlanDrawing shape={shape} boardThicknessMm={thicknessMm} width={drawingWidth} height={drawingHeight} fontSize={fontSize} className="w-full" />
        {/* Edit shape, over the drawing's top left corner. */}
        <button
          type="button"
          onClick={onEdit}
          className="glass-shine absolute left-2 top-2 z-[1] inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3.5 text-[12px] font-medium text-white hover:brightness-95"
          style={glassShineStyle("var(--brand)")}
        >
          <Pencil size={13} />
          {readOnly ? "View shape" : "Edit shape"}
        </button>
        </div>
        <div
          className={`relative shrink-0 overflow-hidden rounded-[12px] border ${stacked ? "mx-auto" : ""}`}
          style={{ width: view3d.width, height: view3d.height, maxWidth: "100%", borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}
        >
          <CutlistCabinet3d model={model} width={view3d.width} height={view3d.height} color={color} />
        </div>
      </div>
    </div>
  );
}
