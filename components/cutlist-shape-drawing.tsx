"use client";

import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Download, Pencil } from "lucide-react";
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
  CABINET_EDGE_ROLE_LABELS,
  cabinetEdgeRoles,
  cabinetPlanSvg,
  cabinetRoleChains,
  cachedCustomCabinetModel,
  cachedCustomCabinetParts,
  customCabinetBandingSummary,
  customCabinetPartClashingText,
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
// one; opened, how it's built — its top view with dimensions, a small 3D view, and its parts — and its shaped parts' DXFs.

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

// What a row opens to (its drop-down arrow, or its popup on a phone): the drawing big enough to read, its outer size and
// banding, Edit shape (View shape, read only) and Download DXF. A custom cabinet's: how it's built (CutlistCabinetDetail).
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
    <div className={`flex gap-4 ${stacked ? "flex-col items-stretch" : "flex-wrap items-center"}`}>
      <CutlistShapeDrawing shape={shape} width={drawingWidth} height={drawingHeight} fontSize={fontSize} className={stacked ? "mx-auto w-full" : "min-w-0 flex-1"} />
      <div className={`flex shrink-0 gap-2 ${stacked ? "flex-col items-stretch" : "flex-col items-start"}`}>
        <p className="text-[12px] font-medium" style={{ color: textColor }}>
          {cutlistShapeSizeText(shape)}
        </p>
        <p className="text-[12px] font-medium" style={{ color: textColor }}>
          {shapeBandingSummary(shape)}
        </p>
        <div className={`flex gap-2 ${stacked ? "flex-row" : "flex-col items-start"}`}>
          <button
            type="button"
            onClick={onEdit}
            className={`glass-shine inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3.5 text-[12px] font-medium text-white hover:brightness-95 ${stacked ? "flex-1" : ""}`}
            style={glassShineStyle("var(--brand)")}
          >
            <Pencil size={13} />
            {readOnly ? "View shape" : "Edit shape"}
          </button>
          <button
            type="button"
            onClick={() => downloadCutlistShapeDxf(shape, name || "Shape")}
            className={`glass-shine glass-shine-neutral inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3.5 text-[12px] font-medium hover:brightness-95 ${stacked ? "flex-1" : ""}`}
            style={{ color: "var(--text-main)" }}
            title={`Download ${shapeDxfFileName(name || "Shape")}`}
          >
            <Download size={13} />
            Download DXF
          </button>
        </div>
      </div>
    </div>
  );
}

// A custom cabinet opened: its top view with its dimensions, a small 3D view (dragged to turn it — a part hovered in the
// list picked out in it), its parts (each one's quantity across the row, its size, and a shaped one's outline), its
// height, size and banding, Edit shape and its shaped parts' DXFs.
export function CutlistCabinetDetail({
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
  stacked?: boolean;
  textColor?: string;
  boardThicknessMm?: number;
  doorGapMm?: number;
  color?: string;
  quantity?: number | string;
}) {
  const thicknessMm = boardMmOf(boardThicknessMm);
  const [hoverPart, setHoverPart] = useState<string | null>(null);
  const parts = cachedCustomCabinetParts(shape, thicknessMm);
  const model = cachedCustomCabinetModel(shape, thicknessMm, doorGapMm);
  const lines = useMemo(() => customCabinetPartLines(parts), [parts]);
  const each = Math.max(1, Number.parseInt(String(quantity ?? "1"), 10) || 1);
  const hasShapedParts = parts.some((part) => part.kind === "shape" && part.shape);
  const view3d = stacked ? { width: 320, height: 220 } : { width: Math.min(340, Math.round(drawingHeight * 1.15)), height: drawingHeight };
  const muted = { color: textColor, opacity: 0.75 } as const;
  return (
    <div className="flex flex-col gap-3">
      <div className={`flex gap-3 ${stacked ? "flex-col items-stretch" : "flex-wrap items-stretch"}`}>
        <CutlistCabinetPlanDrawing
          shape={shape}
          boardThicknessMm={thicknessMm}
          width={drawingWidth}
          height={drawingHeight}
          fontSize={fontSize}
          className={stacked ? "mx-auto w-full" : "min-w-0 flex-1"}
        />
        <div
          className={`relative shrink-0 overflow-hidden rounded-[12px] border ${stacked ? "mx-auto" : ""}`}
          style={{ width: view3d.width, height: view3d.height, maxWidth: "100%", borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}
        >
          <CutlistCabinet3d model={model} width={view3d.width} height={view3d.height} color={color} highlight={hoverPart} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-[12px] font-medium" style={{ color: textColor }}>
          {customCabinetSizeText(shape)}
        </p>
        <p className="text-[12px] font-medium" style={{ color: textColor }}>
          {formatShapeMm(thicknessMm)} mm board
        </p>
        <p className="text-[12px] font-medium" style={{ color: textColor }}>
          {customCabinetBandingSummary(parts)} (each)
        </p>
        <span className="inline-flex items-center gap-3 text-[11px] font-medium" style={{ color: textColor }}>
          {(["back", "end", "doors"] as const).map((role) => (
            <span key={role} className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: CABINET_EDGE_ROLE_COLORS[role] }} />
              {CABINET_EDGE_ROLE_LABELS[role]}
            </span>
          ))}
        </span>
      </div>
      <div className={`flex gap-3 ${stacked ? "flex-col items-stretch" : "flex-wrap items-start"}`}>
        <div className="min-w-0 flex-1 overflow-x-auto rounded-[12px] border" style={{ borderColor: "var(--glass-border)" }}>
          <table className="w-full border-collapse text-[12px] font-medium" style={{ color: textColor }}>
            <thead>
              <tr className="text-left">
                <th className="px-3 py-1.5 font-medium" style={muted}>
                  Part
                </th>
                <th className="px-3 py-1.5 text-center font-medium" style={muted}>
                  Qty
                </th>
                <th className="px-3 py-1.5 font-medium" style={muted}>
                  Size
                </th>
                <th className="px-3 py-1.5 font-medium" style={muted}>
                  Clashing
                </th>
                <th className="px-3 py-1.5 text-center font-medium" style={muted}>
                  Shape
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const part = line.part;
                return (
                  <tr
                    key={line.key}
                    className="border-t transition-colors"
                    style={{ borderColor: "var(--glass-border)", backgroundColor: hoverPart === part.key ? "color-mix(in srgb, var(--brand) 10%, transparent)" : undefined }}
                    onMouseEnter={() => setHoverPart(part.key)}
                    onMouseLeave={() => setHoverPart((prev) => (prev === part.key ? null : prev))}
                  >
                    <td className="whitespace-nowrap px-3 py-1">{line.label}</td>
                    <td className="px-3 py-1 text-center">{part.problem ? "-" : part.quantity * each}</td>
                    <td className="whitespace-nowrap px-3 py-1">{part.problem ? part.problem : customCabinetPartSizeText(part)}</td>
                    <td className="whitespace-nowrap px-3 py-1">
                      {customCabinetPartClashingText(part)}
                    </td>
                    <td className="px-3 py-1">
                      {part.kind === "shape" && part.shape ? (
                        <span className="flex justify-center">
                          <CutlistShapeThumbnail shape={part.shape} color={color} width={48} height={26} strokeColor={textColor} title={line.label} />
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={`flex shrink-0 gap-2 ${stacked ? "flex-row" : "flex-col items-start"}`}>
          <button
            type="button"
            onClick={onEdit}
            className={`glass-shine inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3.5 text-[12px] font-medium text-white hover:brightness-95 ${stacked ? "flex-1" : ""}`}
            style={glassShineStyle("var(--brand)")}
          >
            <Pencil size={13} />
            {readOnly ? "View shape" : "Edit shape"}
          </button>
          <button
            type="button"
            disabled={!hasShapedParts}
            onClick={() => void downloadCustomCabinetDxfs(shape, thicknessMm, name || "Cabinet")}
            className={`glass-shine glass-shine-neutral inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3.5 text-[12px] font-medium hover:brightness-95 disabled:opacity-50 ${stacked ? "flex-1" : ""}`}
            style={{ color: "var(--text-main)" }}
            title="Download its top, bottom and shelves as DXFs (a zip)"
          >
            <Download size={13} />
            Download DXF
          </button>
        </div>
      </div>
    </div>
  );
}
