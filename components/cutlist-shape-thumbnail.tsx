"use client";

import { useMemo } from "react";
import { shapeBandedChains, shapeChainPath, shapeGeometry, shapeOutlinePath, type CutlistShape, type ShapePoint } from "@/lib/cutlist-shape";

// The colour edge banding is drawn in, on a shape (here and in components/cutlist-shape-editor.tsx).
export const CUTLIST_SHAPE_BAND_COLOR = "#D97706";

// A Custom cutlist row's shape, small — in its row (Cutlist Entry and Cutlist List): its outline (its curves and all)
// filled with a wash of its part type's colour, each banded stretch one thicker line in the banding colour. Fitted to
// the box it's given — the box round it as it's cut, curves bowing out included.
export function CutlistShapeThumbnail({
  shape,
  color,
  width = 44,
  height = 28,
  strokeColor = "currentColor",
  className = "",
  title,
}: {
  shape: CutlistShape;
  color: string;
  width?: number;
  height?: number;
  strokeColor?: string;
  className?: string;
  title?: string;
}) {
  const geometry = useMemo(() => shapeGeometry(shape), [shape]);
  if (!geometry.valid) return <svg width={width} height={height} className={className} aria-hidden="true" />;
  const pad = 3;
  const b = geometry.bounds;
  const scale = Math.min((width - 2 * pad) / Math.max(b.width, 1), (height - 2 * pad) / Math.max(b.height, 1));
  const ox = (width - b.width * scale) / 2 - b.minX * scale;
  const oy = (height - b.height * scale) / 2 - b.minY * scale;
  const toScreen = (p: ShapePoint): ShapePoint => [ox + p[0] * scale, oy + p[1] * scale];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={title ?? "Shape"}
    >
      {title ? <title>{title}</title> : null}
      <path d={shapeOutlinePath(geometry, toScreen, scale)} fill={color} fillOpacity={0.3} stroke={strokeColor} strokeWidth={1} strokeLinejoin="round" />
      {shapeBandedChains(geometry).map((chain) => (
        <path
          key={`b${chain.edges[0]}`}
          d={shapeChainPath(geometry, chain, toScreen, scale)}
          fill="none"
          stroke={CUTLIST_SHAPE_BAND_COLOR}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
