"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useView3dGestures } from "@/lib/use-view-3d-gestures";
import { CABINET_EDGE_ROLE_COLORS, cabinetModelFaces, projectCabinetFaces, type CabinetModel, type CabinetView } from "@/lib/cutlist-cabinet-shape";

// A custom cabinet in 3D (lib/cutlist-cabinet-shape.ts's customCabinetModel): every panel in the board's real thickness,
// the doors see-through. Drawn by hand — each face turned by the view's yaw and pitch, the ones facing away left out,
// the rest drawn back to front as SVG polygons, shaded by which way they face. With a mouse: dragged to move it, the
// right (or middle) button dragged to turn it, the wheel to zoom; on a touch screen a finger turns it and two pinch it
// (zoomed and moved). Reset view puts it all back. (The moving and zooming — lib/use-view-3d-gestures.ts — is the shape
// editor's flat piece's 3D view's too.)

// Looking down at it from the front, a little from the right.
export const CABINET_3D_DEFAULT_VIEW: CabinetView = { yaw: -0.6, pitch: 0.5 };
const PITCH_MIN = -0.25;
const PITCH_MAX = 1.5;
// Radians turned per px dragged.
const TURN_PER_PX = 0.01;

// "#RRGGBB" mixed towards another colour (0: as it is, 1: all the other).
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

const pts = (list: Array<[number, number]>): string => list.map((p) => `${Math.round(p[0] * 100) / 100},${Math.round(p[1] * 100) / 100}`).join(" ");

export function CutlistCabinet3d({
  model,
  width,
  height,
  color,
  highlight = null,
  bandedFaces,
  bandColor = CABINET_EDGE_ROLE_COLORS.doors,
  hint,
}: {
  model: CabinetModel;
  // The view's size (px).
  width: number;
  height: number;
  // The board's colour: its faces are shaded from it.
  color: string;
  // A part picked out (customCabinetParts' key — hovered in the parts list).
  highlight?: string | null;
  // Faces in the banding's colour (a flat piece's banded sides — lib/cutlist-cabinet-shape.ts's flatPieceModel).
  bandedFaces?: Set<string>;
  bandColor?: string;
  // Its own words along the bottom (a flat piece's: no doors).
  hint?: string;
}) {
  const [view, setView] = useState<CabinetView>(CABINET_3D_DEFAULT_VIEW);
  // (Taken apart: its ref callback alone goes to `ref`.)
  const { attachTo, handlers, transform, zoomed, resetZoom, coarse } = useView3dGestures({
    onTurn: (dx, dy) =>
      setView((prev) => ({ yaw: prev.yaw + dx * TURN_PER_PX, pitch: Math.min(PITCH_MAX, Math.max(PITCH_MIN, prev.pitch + dy * TURN_PER_PX)) })),
  });
  const faces = useMemo(() => cabinetModelFaces(model), [model]);

  const drawn = useMemo(() => {
    const board = { dark: mixHex(color, "#0F172A", 0.5), light: mixHex(color, "#FFFFFF", 0.62) };
    const door = CABINET_EDGE_ROLE_COLORS.doors;
    return projectCabinetFaces(model, faces, view, { width, height }).map((face) => {
      const picked = Boolean(highlight) && face.part === highlight;
      const fill = face.translucent
        ? mixHex(door, "#FFFFFF", 0.35 * face.light)
        : bandedFaces?.has(face.key)
          ? mixHex(mixHex(bandColor, "#0F172A", 0.25), mixHex(bandColor, "#FFFFFF", 0.35), face.light)
          : mixHex(board.dark, board.light, 0.25 + 0.75 * face.light);
      return {
        key: face.key,
        points: pts(face.screen),
        fill: picked ? mixHex(fill, "#2563EB", 0.45) : fill,
        fillOpacity: face.translucent ? 0.16 : 1,
        stroke: face.translucent ? door : picked ? "#1D4ED8" : mixHex(board.dark, "#0F172A", 0.35),
        strokeOpacity: face.translucent ? 0.55 : picked ? 1 : 0.55,
        picked,
      };
    });
  }, [bandColor, bandedFaces, color, faces, height, highlight, model, view, width]);

  if (!model.prisms.length) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
        Close the outline to see it in 3D.
      </div>
    );
  }
  const turned = Math.abs(view.yaw - CABINET_3D_DEFAULT_VIEW.yaw) > 1e-6 || Math.abs(view.pitch - CABINET_3D_DEFAULT_VIEW.pitch) > 1e-6;
  return (
    <div ref={attachTo} className="absolute inset-0">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 select-none"
        style={{ touchAction: "none", cursor: "grab" }}
        role="img"
        aria-label="The cabinet in 3D — drag to move it, right-drag to turn it, scroll to zoom"
        {...handlers}
      >
        <g transform={transform}>
          {drawn.map((face) => (
            <polygon
              key={face.key}
              points={face.points}
              fill={face.fill}
              fillOpacity={face.fillOpacity}
              stroke={face.stroke}
              strokeOpacity={face.strokeOpacity}
              strokeWidth={face.picked ? 1.2 : 0.7}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        <text x={14} y={height - 14} fontSize={11} fontWeight={500} fill="var(--text-main)" pointerEvents="none">
          {coarse ? "Drag to turn · pinch to zoom" : "Drag to move · right-drag to turn · scroll to zoom"}
          {hint ?? " · doors see-through"}
        </text>
      </svg>
      <button
        type="button"
        disabled={!turned && !zoomed}
        onClick={() => {
          setView(CABINET_3D_DEFAULT_VIEW);
          resetZoom();
        }}
        className="glass-shine glass-shine-neutral absolute left-3 top-3 z-10 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium text-[var(--text-main)] transition hover:brightness-[0.97] disabled:opacity-45"
        title="Back to how it started"
      >
        <RotateCcw size={13} />
        Reset view
      </button>
    </div>
  );
}
