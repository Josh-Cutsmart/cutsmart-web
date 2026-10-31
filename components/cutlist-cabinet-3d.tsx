"use client";

import { useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { GlassSwitch } from "@/components/settings-ui";
import { useView3dGestures, type View3dTurnStart } from "@/lib/use-view-3d-gestures";
import {
  CABINET_EDGE_ROLES,
  CABINET_EDGE_ROLE_COLORS,
  CABINET_EDGE_ROLE_LABELS,
  cabinetFaceLook,
  cabinetModelFaces,
  cabinetRoleLabels,
  mixCabinetColor,
  projectCabinetFaces,
  type CabinetModel,
  type CabinetView,
} from "@/lib/cutlist-cabinet-shape";

// A custom cabinet in 3D (lib/cutlist-cabinet-shape.ts's customCabinetModel) — or a flat piece (flatPieceModel): every
// panel in the board's real thickness, the doors see-through. Drawn by hand — each face turned by the view's yaw and
// pitch, the ones facing away left out, the rest drawn back to front as SVG polygons, shaded by which way they face.
// With a mouse: dragged to move it (the closed hand), the right (or middle) button dragged to turn it (the orbit
// cursor), the wheel to zoom; on a touch screen a finger turns it and two pinch it (zoomed and moved). Reset view puts it
// all back. A cabinet's backs, ends and doors in their roles' colours (as their edges are in 2D), each labelled where
// it's seen, and the colours' key along the bottom. A face clicked or tapped (not the end of a drag) — and the one under the pointer — is told (`onFaceTap`,
// `onFaceHover`): the shape editor sets an edge from it, as a click on it in 2D does. (The moving and zooming:
// lib/use-view-3d-gestures.ts.)

// Looking down at it from the front, a little from the right.
export const CABINET_3D_DEFAULT_VIEW: CabinetView = { yaw: -0.6, pitch: 0.5 };
const PITCH_MIN = -0.25;
const PITCH_MAX = 1.5;
// Radians turned per px dragged.
const TURN_PER_PX = 0.01;
export const turnCabinetView = (view: CabinetView, dx: number, dy: number): CabinetView => ({
  yaw: view.yaw + dx * TURN_PER_PX,
  pitch: Math.min(PITCH_MAX, Math.max(PITCH_MIN, view.pitch + dy * TURN_PER_PX)),
});

const pts = (list: Array<[number, number]>): string => list.map((p) => `${Math.round(p[0] * 100) / 100},${Math.round(p[1] * 100) / 100}`).join(" ");

// (A point inside a face's outline on the screen.)
function inside(point: [number, number], polygon: Array<[number, number]>): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

export type Cabinet3dFace = { key: string; part: string };

// A cabinet's roles shown or not (Labels, on or off) — kept for the visit (and on this device, where it can be).
const ROLES_STORAGE_KEY = "cutsmart_cabinet_3d_roles";
let rolesShownForVisit: boolean | null = null;
export function readCabinetRolesShown(): boolean {
  if (rolesShownForVisit !== null) return rolesShownForVisit;
  try {
    rolesShownForVisit = typeof window === "undefined" ? true : window.localStorage.getItem(ROLES_STORAGE_KEY) !== "off";
  } catch {
    rolesShownForVisit = true;
  }
  return rolesShownForVisit;
}
export function rememberCabinetRolesShown(on: boolean) {
  rolesShownForVisit = on;
  try {
    window.localStorage.setItem(ROLES_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // (Not kept past the visit, then.)
  }
}

export function CutlistCabinet3d({
  model,
  width,
  height,
  color,
  highlight = null,
  bandedFaces,
  bandColor = CABINET_EDGE_ROLE_COLORS.doors,
  litFaces,
  view: shownView,
  setView: setShownView,
  startTurn = null,
  onFaceTap,
  onFaceHover,
  showRoles: shownRoles,
  setShowRoles: setShownRoles,
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
  // Faces picked out (a flat piece's edge run under the pointer).
  litFaces?: Set<string>;
  // Which way it's turned — given (with how it's changed), it's kept by what it's in (the shape editor's, for its
  // export); else its own.
  view?: CabinetView;
  setView?: (update: (prev: CabinetView) => CabinetView) => void;
  // A turn already under way as it's put up (a right-drag on the 2D drawing, carried on).
  startTurn?: View3dTurnStart | null;
  onFaceTap?: (face: Cabinet3dFace) => void;
  onFaceHover?: (face: Cabinet3dFace | null) => void;
  // A cabinet's roles shown (its backs, ends and doors in their colours, labelled, with their key) or a plain cabinet —
  // switched on it (Labels). Given, kept by what it's in (the shape editor's, for its export); else its own.
  showRoles?: boolean;
  setShowRoles?: (on: boolean) => void;
}) {
  const [ownRoles, setOwnRoles] = useState(readCabinetRolesShown);
  const rolesOn = shownRoles ?? ownRoles;
  const setRolesOn = (on: boolean) => {
    rememberCabinetRolesShown(on);
    if (setShownRoles) setShownRoles(on);
    else setOwnRoles(on);
  };
  const [ownView, setOwnView] = useState<CabinetView>(CABINET_3D_DEFAULT_VIEW);
  const view = shownView ?? ownView;
  const setView = (update: (prev: CabinetView) => CabinetView) => {
    if (setShownView) setShownView(update);
    else setOwnView(update);
  };
  // (The face last said to be under the pointer — said again only when it changes.)
  const hoveredRef = useRef<string | null>(null);
  const faces = useMemo(() => cabinetModelFaces(model), [model]);
  const projected = useMemo(() => projectCabinetFaces(model, faces, view, { width, height }), [faces, height, model, view, width]);
  // The face at a point (client px): the nearest the eye — the last drawn — whose outline it's in.
  const faceAt = (clientX: number, clientY: number, box: DOMRect | undefined, zoom: { z: number; x: number; y: number }): Cabinet3dFace | null => {
    if (!box) return null;
    const point: [number, number] = [(clientX - box.left - zoom.x) / zoom.z, (clientY - box.top - zoom.y) / zoom.z];
    for (let i = projected.length - 1; i >= 0; i -= 1) {
      const face = projected[i];
      if (face.translucent && !onFaceTap) continue;
      if (inside(point, face.screen)) return { key: face.key, part: face.part };
    }
    return null;
  };
  const hostRef = useRef<HTMLDivElement | null>(null);
  // (Taken apart: its ref callback alone goes to `ref`.)
  const { attachTo, handlers, transform, zoom, zoomed, resetZoom, cursor, coarse } = useView3dGestures({
    onTurn: (dx, dy) => setView((prev) => turnCabinetView(prev, dx, dy)),
    onTap: onFaceTap
      ? (x, y) => {
          const face = faceAt(x, y, hostRef.current?.getBoundingClientRect(), zoom);
          if (face) onFaceTap(face);
        }
      : undefined,
    startTurn,
  });

  const drawn = useMemo(
    () =>
      projected.map((face) => {
        const picked = (Boolean(highlight) && face.part === highlight) || Boolean(litFaces?.has(face.key));
        const look = cabinetFaceLook(face, color, { bandedFaces, bandColor, roles: rolesOn });
        return {
          key: face.key,
          points: pts(face.screen),
          // (Picked out — under the pointer, or in the parts list — a brand wash over its own colour.)
          fill: picked ? mixCabinetColor(look.fill, "#2563EB", 0.45) : look.fill,
          fillOpacity: face.translucent ? (picked ? 0.36 : look.fillOpacity) : 1,
          stroke: picked ? "#1D4ED8" : look.stroke,
          strokeOpacity: face.translucent ? 0.55 : picked ? 1 : 0.55,
          picked,
        };
      }),
    [bandColor, bandedFaces, color, highlight, litFaces, projected, rolesOn],
  );
  // Each back, end and door labelled with its role — where it's seen, at its size on the screen however it's zoomed.
  const hasRoles = model.prisms.some((prism) => prism.kind === "back" || prism.kind === "end" || prism.kind === "door");
  const roleLabels = useMemo(
    () =>
      hasRoles && rolesOn
        ? cabinetRoleLabels(projected, (text) => ({ width: text.length * 6.4 + 14, height: 18 }), (p) => [p[0] * zoom.z + zoom.x, p[1] * zoom.z + zoom.y])
        : [],
    [hasRoles, projected, rolesOn, zoom],
  );

  if (!model.prisms.length) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
        Close the outline to see it in 3D.
      </div>
    );
  }
  const turned = Math.abs(view.yaw - CABINET_3D_DEFAULT_VIEW.yaw) > 1e-6 || Math.abs(view.pitch - CABINET_3D_DEFAULT_VIEW.pitch) > 1e-6;
  return (
    // (Its pointer events heard on this — which a drag holds the pointer to, a turn handed over included.)
    <div
      ref={(el) => {
        hostRef.current = el;
        attachTo(el);
      }}
      className="absolute inset-0"
      style={{ touchAction: "none", cursor }}
      {...handlers}
      onPointerMove={(event) => {
        handlers.onPointerMove(event);
        if (!onFaceHover || event.buttons !== 0) return;
        const face = faceAt(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), zoom);
        if ((face?.key ?? null) === hoveredRef.current) return;
        hoveredRef.current = face?.key ?? null;
        onFaceHover(face);
      }}
      onPointerLeave={() => {
        if (hoveredRef.current === null || !onFaceHover) return;
        hoveredRef.current = null;
        onFaceHover(null);
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 select-none"
        role="img"
        aria-label={coarse ? "In 3D — drag to turn it, pinch to zoom" : "In 3D — drag to move it, right-drag to turn it, scroll to zoom"}
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
        {roleLabels.map((label) => (
          <g key={`role${label.part}`} pointerEvents="none">
            <rect x={label.x - label.width / 2} y={label.y - label.height / 2} width={label.width} height={label.height} rx={label.height / 2} fill={CABINET_EDGE_ROLE_COLORS[label.role]} />
            <text x={label.x} y={label.y} dy="0.35em" textAnchor="middle" fontSize={11} fontWeight={500} fill="#FFFFFF" style={{ userSelect: "none" }}>
              {label.text}
            </text>
          </g>
        ))}
      </svg>
      {/* The roles' colours — and, a cabinet, Labels: its roles shown, or a plain cabinet. */}
      {hasRoles ? (
        <label
          className="glass-shine glass-shine-neutral absolute bottom-3 right-3 z-10 inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border pl-3 pr-1.5 text-[12px] font-medium text-[var(--text-main)]"
          onPointerDown={(event) => event.stopPropagation()}
        >
          Labels
          <GlassSwitch size="sm" checked={rolesOn} onChange={setRolesOn} ariaLabel="Labels — the panels' roles in their colours" />
        </label>
      ) : null}
      {hasRoles && rolesOn ? (
        <div
          className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-full border px-3 py-1 text-[11.5px] font-medium"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 88%, transparent)", color: "var(--text-main)" }}
        >
          {CABINET_EDGE_ROLES.map((role) => (
            <span key={role} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-[4px] w-4 rounded-full" style={{ backgroundColor: CABINET_EDGE_ROLE_COLORS[role] }} />
              {CABINET_EDGE_ROLE_LABELS[role]}
            </span>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        disabled={!turned && !zoomed}
        onClick={() => {
          setView(() => CABINET_3D_DEFAULT_VIEW);
          resetZoom();
        }}
        className="glass-shine glass-shine-neutral absolute left-3 top-3 z-10 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium text-[var(--text-main)] transition hover:brightness-[0.97] disabled:opacity-45"
        style={{ cursor: "pointer" }}
        title="Back to how it started"
      >
        <RotateCcw size={13} />
        Reset view
      </button>
    </div>
  );
}
