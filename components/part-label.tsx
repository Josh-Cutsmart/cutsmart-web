"use client";

import { memo, useMemo } from "react";
import { LABEL_PT, layoutPartLabel, type LabelSize, type PartLabel } from "@/lib/part-labels";

// A piece's label on screen (Production › Labels) — drawn from the same layout its printed label is
// (lib/part-labels.ts), so it looks just as it'll print. White, as the label is, whatever the app's theme; its size on
// screen is `pxPerMm` to the mm (smaller to fit a narrow screen).
export const PartLabelPreview = memo(function PartLabelPreview({
  label,
  size,
  logo,
  pxPerMm,
}: {
  label: PartLabel;
  size: LabelSize;
  logo: { dataUrl: string; width: number; height: number } | null;
  pxPerMm: number;
}) {
  const ops = useMemo(() => layoutPartLabel(label, size, logo), [label, size, logo]);
  return (
    <svg
      viewBox={`0 0 ${size.width} ${size.height}`}
      width={size.width * pxPerMm}
      height={size.height * pxPerMm}
      role="img"
      aria-label={`Label ${label.id}: ${label.name}`}
      className="block h-auto max-w-full"
      style={{ backgroundColor: "#FFFFFF", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      {ops.map((op, index) => {
        if (op.kind === "rect") {
          return (
            <rect
              key={index}
              x={op.x}
              y={op.y}
              width={op.w}
              height={op.h}
              rx={op.radius}
              fill={op.fill ?? "none"}
              stroke={op.stroke ?? "none"}
              strokeWidth={op.lineWidth ?? 0.3}
            />
          );
        }
        if (op.kind === "line") {
          return <line key={index} x1={op.x1} y1={op.y1} x2={op.x2} y2={op.y2} stroke={op.stroke} strokeWidth={op.lineWidth} strokeLinecap="round" />;
        }
        if (op.kind === "circle") {
          return <circle key={index} cx={op.cx} cy={op.cy} r={op.r} fill="none" stroke={op.stroke} strokeWidth={op.lineWidth} />;
        }
        if (op.kind === "text") {
          return (
            <text
              key={index}
              x={op.x}
              y={op.y}
              fontSize={op.size * LABEL_PT}
              fontWeight={op.bold ? 700 : 400}
              fill={op.color}
              textAnchor={op.align === "center" ? "middle" : op.align === "right" ? "end" : "start"}
              style={{ whiteSpace: "pre" }}
            >
              {op.text}
            </text>
          );
        }
        return logo ? <image key={index} href={logo.dataUrl} x={op.x} y={op.y} width={op.w} height={op.h} preserveAspectRatio="xMidYMid meet" /> : null;
      })}
    </svg>
  );
});
