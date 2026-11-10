import { evaluateDimensionMath } from "@/lib/dimension-math";

export type DoorHingeSide = "" | "LH" | "RH" | "Mirror" | "Top";

const HINGE_SIDES: Exclude<DoorHingeSide, "">[] = ["LH", "RH", "Mirror", "Top"];

const HINGE_SIDE_TITLES: Record<Exclude<DoorHingeSide, "">, string> = {
  LH: "Hinges on the left",
  RH: "Hinges on the right",
  Mirror: "A pair: the left door's on its left, the right door's on its right",
  Top: "Hinged along the top",
};

function sizeFrom(value: string | number | undefined, fallback: number): number {
  const n = Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function positionsFrom(values: string[]): number[] {
  // (A sum, as the boxes take: what it comes to.)
  return values
    .map((value) => {
      const text = String(value ?? "").trim();
      return Number.parseFloat(evaluateDimensionMath(text) ?? text);
    })
    .filter((n) => Number.isFinite(n) && n >= 0);
}

// A small drawing of the door with its hinges where they'll go: on its left (LH) or right (RH) edge — Up measured up
// from the bottom, Down measured down from the top — a pair of doors for Mirror (the left one's on its left, the right
// one's on its right), or along its top for Top (LH from the left, RH from the right). In proportion, the full maxHeight
// tall however small or wide the piece: it sits in a maxWidth-wide space against its right, and one wider than that
// grows out of it to the left (into the free room there — up to maxGrowWidth, past which it's that wide and shorter, in
// proportion). No side yet: on its left, faded. No size yet: a usual door's shape.
export function DoorHingeDiagram({
  height,
  width,
  up,
  down,
  side,
  color = "currentColor",
  maxWidth = 56,
  maxHeight = 44,
  maxGrowWidth,
}: {
  height?: string;
  width?: string;
  up: string[];
  down: string[];
  side: DoorHingeSide;
  color?: string;
  maxWidth?: number;
  maxHeight?: number;
  maxGrowWidth?: number;
}) {
  const doorH = sizeFrom(height, 720);
  const doorW = sizeFrom(width, 450);
  const pair = side === "Mirror";
  const gap = 2;
  const pad = 1;
  // The full height, its width in proportion — unless that's wider than it may grow (a pair: both doors), then that
  // wide and its height in proportion to it.
  const roomForOne = (Math.max(maxWidth, maxGrowWidth ?? maxWidth) - (pair ? gap : 0)) / (pair ? 2 : 1);
  const ratio = doorW / doorH;
  const w = Math.max(5, Math.min(roomForOne, ratio * maxHeight));
  const h = Math.min(maxHeight, w / ratio);
  const scaleY = h / doorH;
  const scaleX = w / doorW;
  const mark = 3.4;
  const inset = 1.3;
  const ups = positionsFrom(up);
  const downs = positionsFrom(down);
  const clampAlong = (value: number, length: number) => Math.min(length - mark / 2 - inset, Math.max(mark / 2 + inset, value));
  const doors: { x: number; edge: "left" | "right" | "top" }[] = pair
    ? [{ x: pad, edge: "left" }, { x: pad + w + gap, edge: "right" }]
    : [{ x: pad, edge: side === "RH" ? "right" : side === "Top" ? "top" : "left" }];
  const totalW = (pair ? w * 2 + gap : w) + pad * 2;
  const totalH = h + pad * 2;
  // In its maxWidth-wide space, against its right: a wider or narrower door grows to the left (out of the space, if it's
  // wider), never moving what's beside it.
  return (
    <span className="inline-flex shrink-0 items-center justify-end" style={{ width: maxWidth + pad * 2, height: maxHeight + pad * 2 }}>
      <svg
        width={totalW}
        height={totalH}
        viewBox={`0 0 ${totalW} ${totalH}`}
        role="img"
        aria-label={side ? `Door drawing, ${HINGE_SIDE_TITLES[side].toLowerCase()}` : "Door drawing, no hinge side yet"}
        className="shrink-0 overflow-visible"
      >
        {doors.map((door, doorIndex) => {
          const marks =
            door.edge === "top"
              ? [...ups.map((v) => v * scaleX), ...downs.map((v) => w - v * scaleX)].map((x) => ({
                  x: door.x + clampAlong(x, w) - mark / 2,
                  y: pad + inset,
                }))
              : [...ups.map((v) => h - v * scaleY), ...downs.map((v) => v * scaleY)].map((y) => ({
                  x: door.edge === "left" ? door.x + inset : door.x + w - inset - mark,
                  y: pad + clampAlong(y, h) - mark / 2,
                }));
          return (
            <g key={doorIndex}>
              <rect x={door.x} y={pad} width={w} height={h} rx={1.6} fill="rgba(255, 255, 255, 0.85)" stroke={color} strokeWidth={1.2} />
              {marks.map((m, markIndex) => (
                <rect key={markIndex} x={m.x} y={m.y} width={mark} height={mark} rx={0.9} fill={color} opacity={side ? 1 : 0.45} />
              ))}
            </g>
          );
        })}
      </svg>
    </span>
  );
}

// A door's hinges measured: the door to scale, marked Front (the side they're measured on), each hinge's 35 mm cup with its centre
// 22.5 mm in from the hinged edge, as on its label (lib/part-labels.ts), and outside that edge a dimension line for each from the
// end it's measured from, so it can't be read from the wrong end: Up from the bottom, Down from the top, or along the top LH from
// the left and RH from the right. The shortest of them nearest the door, so none of the lines to the cups cross another. A pair
// (Mirror): both doors, each hinged on its outer edge. Its size and side under it. One past the end of the door shows red.
const CUP_RADIUS_MM = 17.5;
const CUP_INSET_MM = 22.5;

type MeasuredMark = { value: number; from: "start" | "end"; lane: number };

export function DoorHingeMeasured({
  height,
  width,
  up,
  down,
  side,
  doorMaxWidth,
  doorMaxHeight,
  large = false,
}: {
  height?: string;
  width?: string;
  up: string[];
  down: string[];
  side: DoorHingeSide;
  doorMaxWidth: number;
  doorMaxHeight: number;
  // In the pop-up: its numbers bigger.
  large?: boolean;
}) {
  const doorH = sizeFrom(height, 720);
  const doorW = sizeFrom(width, 450);
  const pair = side === "Mirror";
  const onTop = side === "Top";
  const font = large ? 14 : 12;
  const laneGap = font * 1.9;
  const doorGap = 10;
  // (Down from the top, or RH along it: the far end's.)
  const length = onTop ? doorW : doorH;
  const ups = positionsFrom(up).sort((a, b) => a - b);
  const downs = positionsFrom(down).sort((a, b) => a - b);
  const reach = (values: number[]) => (values.length ? values[values.length - 1] : 0);
  // The two ends can share lanes, unless they'd run into each other.
  const downsFrom = reach(ups) + reach(downs) > length ? ups.length : 0;
  const marks: MeasuredMark[] = [
    ...ups.map((value, lane) => ({ value, from: "start" as const, lane })),
    ...downs.map((value, index) => ({ value, from: "end" as const, lane: downsFrom + index })),
  ];
  const lanes = Math.max(0, ...marks.map((mark) => mark.lane + 1));
  const laneRoom = lanes ? 16 + lanes * laneGap : 6;
  const roomForOne = (doorMaxWidth - (pair ? doorGap : 0)) / (pair ? 2 : 1);
  const scale = Math.min(roomForOne / doorW, doorMaxHeight / doorH);
  // (A very thin door or flap is drawn a little wider than it is, to fit what's on it.)
  const w = Math.max(64, doorW * scale);
  const h = Math.max(64, doorH * scale);
  const perMmAlong = (onTop ? w : h) / length;
  const perMmAcross = (onTop ? h : w) / (onTop ? doorH : doorW);
  const cupR = Math.max(5, CUP_RADIUS_MM * Math.min(perMmAlong, perMmAcross));
  const cupInset = Math.max(cupR + 2, CUP_INSET_MM * perMmAcross);
  const leftRoom = onTop ? 6 : side === "RH" ? 6 : laneRoom;
  const rightRoom = onTop ? 6 : side === "RH" || pair ? laneRoom : 6;
  const topRoom = onTop ? laneRoom : 6;
  const totalW = leftRoom + w + (pair ? doorGap + w : 0) + rightRoom;
  const totalH = topRoom + h + 6;
  const doors: { x: number; edge: "left" | "right" | "top" }[] = pair
    ? [{ x: leftRoom, edge: "left" }, { x: leftRoom + w + doorGap, edge: "right" }]
    : [{ x: leftRoom, edge: side === "RH" ? "right" : onTop ? "top" : "left" }];
  const ink = "var(--text-main)";
  const soft = "var(--text-muted)";
  const y0 = topRoom;
  const caption = [`H ${doorH} × W ${doorW}`, pair ? "a pair" : side || "no side picked yet"].join("  ·  ");
  return (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <svg
        width={totalW}
        height={totalH}
        viewBox={`0 0 ${totalW} ${totalH}`}
        role="img"
        aria-label={`Door drawing, front, ${caption}`}
        className="block h-auto max-w-full"
        style={{ fontFamily: "inherit" }}
      >
        {doors.map((door, doorIndex) => (
          <g key={doorIndex}>
            <rect x={door.x} y={y0} width={w} height={h} rx={3} fill="color-mix(in srgb, var(--panel-bg) 88%, transparent)" stroke={ink} strokeWidth={1.5} />
            <text x={door.x + w / 2} y={y0 + h / 2} fontSize={font} fontWeight={500} fill={ink} textAnchor="middle" dominantBaseline="central">
              Front
            </text>
            {/* Its sizes inside it, each along its own side: the width along the bottom, the height up the side away
                from the hinges (turned to read along it). */}
            {(() => {
              const inset = 6;
              const heightX = door.edge === "right" ? door.x + inset + font * 0.72 : door.x + w - inset;
              const middle = y0 + h / 2;
              return (
                <>
                  <text x={door.x + w / 2} y={y0 + h - inset} fontSize={font} fontWeight={500} fill={ink} textAnchor="middle">
                    {doorW}
                  </text>
                  <text x={heightX} y={middle} fontSize={font} fontWeight={500} fill={ink} textAnchor="middle" transform={`rotate(-90 ${heightX} ${middle})`}>
                    {doorH}
                  </text>
                </>
              );
            })()}
            {marks.map((mark, markIndex) => {
              const off = mark.value > length;
              const along = Math.min(mark.value, length) * perMmAlong;
              const stroke = off ? "var(--danger-strong)" : soft;
              const text = off ? "var(--danger-strong)" : ink;
              const label = String(mark.value);
              const tick = 4;
              if (door.edge === "top") {
                // Along the top: lanes up from it, LH from the left, RH from the right.
                const cx = door.x + (mark.from === "start" ? along : w - along);
                const cy = y0 + cupInset;
                const laneY = y0 - 10 - mark.lane * laneGap;
                const startX = mark.from === "start" ? door.x : door.x + w;
                return (
                  <g key={markIndex}>
                    <line x1={cx} y1={cy - cupR} x2={cx} y2={laneY} stroke={stroke} strokeWidth={0.8} strokeDasharray="2 3" />
                    <line x1={startX} y1={y0} x2={startX} y2={laneY - tick} stroke={stroke} strokeWidth={0.8} />
                    <line x1={startX} y1={laneY} x2={cx} y2={laneY} stroke={stroke} strokeWidth={1} />
                    <line x1={cx} y1={laneY - tick} x2={cx} y2={laneY + tick} stroke={stroke} strokeWidth={1} />
                    <text x={(startX + cx) / 2} y={laneY - 4} fontSize={font} fontWeight={500} fill={text} textAnchor="middle">{label}</text>
                    <circle cx={cx} cy={cy} r={cupR} fill="color-mix(in srgb, var(--brand) 16%, transparent)" stroke={stroke === soft ? ink : stroke} strokeWidth={1.2} />
                  </g>
                );
              }
              // Up or down an edge: lanes out from it, Up from the bottom, Down from the top.
              const out = door.edge === "left" ? -1 : 1;
              const edgeX = door.edge === "left" ? door.x : door.x + w;
              const cx = edgeX - out * cupInset;
              const cy = y0 + (mark.from === "start" ? h - along : along);
              const laneX = edgeX + out * (10 + mark.lane * laneGap);
              const startY = mark.from === "start" ? y0 + h : y0;
              const middle = (startY + cy) / 2;
              const textX = laneX + (door.edge === "left" ? -4 : 4 + font * 0.72);
              return (
                <g key={markIndex}>
                  <line x1={cx - out * -cupR} y1={cy} x2={laneX} y2={cy} stroke={stroke} strokeWidth={0.8} strokeDasharray="2 3" />
                  <line x1={edgeX} y1={startY} x2={laneX + out * tick} y2={startY} stroke={stroke} strokeWidth={0.8} />
                  <line x1={laneX} y1={startY} x2={laneX} y2={cy} stroke={stroke} strokeWidth={1} />
                  <line x1={laneX - tick} y1={cy} x2={laneX + tick} y2={cy} stroke={stroke} strokeWidth={1} />
                  <text x={textX} y={middle} fontSize={font} fontWeight={500} fill={text} textAnchor="middle" transform={`rotate(-90 ${textX} ${middle})`}>{label}</text>
                  <circle cx={cx} cy={cy} r={cupR} fill="color-mix(in srgb, var(--brand) 16%, transparent)" stroke={stroke === soft ? ink : stroke} strokeWidth={1.2} />
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      {/* (Its sizes are on the door itself, and its side shows by where the hinges are: underneath, only a door with no
          side picked yet says so — in the pop-up, in the drawing's own ink.) */}
      {side ? null : (
        <p className="whitespace-nowrap text-[12px] font-medium" style={{ color: large ? ink : soft }}>
          No hinge side picked yet
        </p>
      )}
    </div>
  );
}

// The hinge side as one rounded switch (LH / RH / Mirror / Top) — the one picked in a glossy white, picked again to
// clear it. No onChange: just showing it.
export function HingeSideToggle({
  value,
  onChange,
  disabled,
  compact = false,
}: {
  value: DoorHingeSide;
  onChange?: (value: DoorHingeSide) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const readOnly = disabled || !onChange;
  return (
    <div
      role="group"
      aria-label="Hinge side"
      className="inline-flex shrink-0 items-center rounded-full p-[3px]"
      style={{ backgroundColor: "rgba(15, 23, 42, 0.08)" }}
    >
      {HINGE_SIDES.map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            disabled={readOnly}
            onClick={() => onChange?.(active ? "" : option)}
            title={readOnly ? HINGE_SIDE_TITLES[option] : active ? "Clear the hinge side" : HINGE_SIDE_TITLES[option]}
            className={`${compact ? "h-[22px] px-[8px] text-[11.5px]" : "h-[26px] px-[10px] text-[12px]"} rounded-full border leading-none transition-colors ${
              active ? "font-semibold" : `border-transparent font-medium ${readOnly ? "" : "hover:bg-white/50"}`
            } disabled:cursor-default`}
            style={
              active
                ? {
                    background: "linear-gradient(160deg, #FFFFFF 0%, #FFFFFF 40%, #EEF1F5 100%)",
                    borderColor: "rgba(255, 255, 255, 0.95)",
                    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.16)",
                    color: "#111111",
                  }
                : { color: "inherit", opacity: readOnly ? 0.6 : 1 }
            }
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
