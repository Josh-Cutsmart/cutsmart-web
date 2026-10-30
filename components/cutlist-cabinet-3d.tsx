"use client";

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { RotateCcw } from "lucide-react";
import { CABINET_EDGE_ROLE_COLORS, cabinetModelFaces, projectCabinetFaces, type CabinetModel, type CabinetView } from "@/lib/cutlist-cabinet-shape";

// A custom cabinet in 3D (lib/cutlist-cabinet-shape.ts's customCabinetModel): every panel in the board's real thickness,
// the doors see-through. Drawn by hand — each face turned by the view's yaw and pitch, the ones facing away left out,
// the rest drawn back to front as SVG polygons, shaded by which way they face. Dragged to turn it (the left or middle
// mouse button, or a finger); Reset view puts it back.

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
}: {
  model: CabinetModel;
  // The view's size (px).
  width: number;
  height: number;
  // The board's colour: its faces are shaded from it.
  color: string;
  // A part picked out (customCabinetParts' key — hovered in the parts list).
  highlight?: string | null;
}) {
  const [view, setView] = useState<CabinetView>(CABINET_3D_DEFAULT_VIEW);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; yaw: number; pitch: number } | null>(null);
  const faces = useMemo(() => cabinetModelFaces(model), [model]);

  const drawn = useMemo(() => {
    const board = { dark: mixHex(color, "#0F172A", 0.5), light: mixHex(color, "#FFFFFF", 0.62) };
    const door = CABINET_EDGE_ROLE_COLORS.doors;
    return projectCabinetFaces(model, faces, view, { width, height }).map((face) => {
      const picked = Boolean(highlight) && face.part === highlight;
      const fill = face.translucent ? mixHex(door, "#FFFFFF", 0.35 * face.light) : mixHex(board.dark, board.light, 0.25 + 0.75 * face.light);
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
  }, [color, faces, height, highlight, model, view, width]);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 1) return;
    // (The middle button: no autoscroll.)
    if (event.button === 1) event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, yaw: view.yaw, pitch: view.pitch };
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, drag.pitch + (event.clientY - drag.y) * TURN_PER_PX));
    setView({ yaw: drag.yaw + (event.clientX - drag.x) * TURN_PER_PX, pitch });
  };
  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  if (!model.prisms.length) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>
        Close the outline to see it in 3D.
      </div>
    );
  }
  const turned = Math.abs(view.yaw - CABINET_3D_DEFAULT_VIEW.yaw) > 1e-6 || Math.abs(view.pitch - CABINET_3D_DEFAULT_VIEW.pitch) > 1e-6;
  return (
    <div className="absolute inset-0">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 select-none"
        style={{ touchAction: "none", cursor: "grab" }}
        role="img"
        aria-label="The cabinet in 3D — drag to turn it"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onMouseDown={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        onAuxClick={(event) => event.preventDefault()}
        onContextMenu={(event) => {
          if (dragRef.current) event.preventDefault();
        }}
      >
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
          />
        ))}
        <text x={14} y={height - 14} fontSize={11} fontWeight={500} fill="var(--text-muted)" pointerEvents="none">
          Drag to turn it · doors shown see-through
        </text>
      </svg>
      <button
        type="button"
        disabled={!turned}
        onClick={() => setView(CABINET_3D_DEFAULT_VIEW)}
        className="glass-shine glass-shine-neutral absolute right-3 top-3 z-10 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium text-[var(--text-main)] transition hover:brightness-[0.97] disabled:opacity-45"
        title="Back to how it started"
      >
        <RotateCcw size={13} />
        Reset view
      </button>
    </div>
  );
}
