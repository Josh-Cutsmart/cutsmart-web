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
  return values.map((value) => Number.parseFloat(String(value))).filter((n) => Number.isFinite(n) && n >= 0);
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
