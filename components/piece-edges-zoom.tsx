"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EdgeTapeMenu } from "@/components/edge-tape-menu";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { evaluateDimensionMath } from "@/lib/dimension-math";
import { EDGE_KEYS, edgeSide, type EdgeKey, type EdgeSide, type ResolvedEdge, type RowEdges } from "@/lib/edge-tapes";

// A cutlist piece's small drawing with an X on each clashed edge (as its part label marks them): pointed at, a bigger one
// with its size and any edge on a different tape named springs out of it, as the door hinge drawing's does; clicked, that
// grows into a pop-up where any edge can be clicked to clash it, put it on the board's own tape (Matching) or one of the
// company's edge tapes (Company Settings › Materials & Boards), or unclash it.

export type PieceEdgeTapeOption = { id: string; name: string; label: string };

const PREVIEW_BOX = { width: 240, height: 220 };
const PREVIEW_GAP_PX = 10;
const SCREEN_EDGE_PX = 8;
const GROW_MS = 340;
const SHRINK_MS = 220;
const HOVER_GRACE_MS = 160;
const PHONE_SHEET_QUERY = "(max-width: 639.98px)";
const ACCENT = "#B45309";

const mmOf = (value: unknown) => {
  const text = String(value ?? "").trim();
  const n = Number.parseFloat(evaluateDimensionMath(text) ?? text);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function overBox(from: DOMRect, to: DOMRect): string {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${Math.max(0.05, from.width / to.width)}, ${Math.max(0.05, from.height / to.height)})`;
}
function canMorph(element: HTMLElement | null): element is HTMLElement {
  return (
    !!element &&
    typeof element.animate === "function" &&
    !window.matchMedia(PHONE_SHEET_QUERY).matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// The piece's outline fitted in a box: its width across, its height down (a square when it has no size yet).
function fit(heightMm: number, widthMm: number, boxW: number, boxH: number) {
  const h = heightMm || 1;
  const w = widthMm || 1;
  const scale = Math.min(boxW / w, boxH / h);
  return { w: Math.max(6, w * scale), h: Math.max(6, h * scale) };
}

// An X at (cx, cy).
function Cross({ cx, cy, half, stroke, width }: { cx: number; cy: number; half: number; stroke: string; width: number }) {
  return (
    <g stroke={stroke} strokeWidth={width} strokeLinecap="round">
      <line x1={cx - half} y1={cy - half} x2={cx + half} y2={cy + half} />
      <line x1={cx - half} y1={cy + half} x2={cx + half} y2={cy - half} />
    </g>
  );
}

const midOf = (side: EdgeSide, x: number, y: number, w: number, h: number) =>
  side === "top" ? { x: x + w / 2, y } : side === "bottom" ? { x: x + w / 2, y: y + h } : side === "left" ? { x, y: y + h / 2 } : { x: x + w, y: y + h / 2 };

// The small drawing, in the cell.
export function PieceEdgesDiagram({ height, width, edges, color, size = 26 }: { height?: string; width?: string; edges: ResolvedEdge[]; color?: string; size?: number }) {
  const hMm = mmOf(height);
  const wMm = mmOf(width);
  const tall = hMm > wMm;
  const box = fit(hMm, wMm, size - 6, size - 6);
  const x = (size - box.w) / 2;
  const y = (size - box.h) / 2;
  const ink = "currentColor";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ display: "block" }}>
      <rect x={x} y={y} width={box.w} height={box.h} rx={1.2} fill={color ? `color-mix(in srgb, ${color} 35%, white)` : "none"} stroke={ink} strokeOpacity={0.55} strokeWidth={1} />
      {edges.map((edge) => {
        const side = edgeSide(edge.key, tall);
        const mid = midOf(side, x, y, box.w, box.h);
        return <Cross key={edge.key} cx={mid.x} cy={mid.y} half={2.4} stroke={edge.tapeId ? ACCENT : ink} width={1.3} />;
      })}
    </svg>
  );
}

// The bigger drawing (the floating one and the pop-up's): its size along its edges, an X on each clashed edge, an edge on
// a different tape named beside it — and, in the pop-up, each edge something to click.
function PieceEdgesMeasured({
  height,
  width,
  edges,
  tapes,
  color,
  boxWidth,
  boxHeight,
  onEdgeClick,
  onEdgeMenu,
}: {
  height?: string;
  width?: string;
  edges: ResolvedEdge[];
  tapes: PieceEdgeTapeOption[];
  color?: string;
  boxWidth: number;
  boxHeight: number;
  onEdgeClick?: (key: EdgeKey, event: React.MouseEvent<SVGElement>) => void;
  onEdgeMenu?: (key: EdgeKey, event: React.MouseEvent<SVGElement>) => void;
}) {
  const hMm = mmOf(height);
  const wMm = mmOf(width);
  const tall = hMm > wMm;
  const pad = 54;
  const box = fit(hMm, wMm, Math.max(40, boxWidth - pad * 2), Math.max(40, boxHeight - pad * 2));
  const svgW = box.w + pad * 2;
  const svgH = box.h + pad * 2;
  const x = pad;
  const y = pad;
  const nameOf = (id: string) => tapes.find((tape) => tape.id === id)?.name || "Other tape";
  const byKey = new Map(edges.map((edge) => [edge.key, edge]));
  const ink = "var(--text-main)";
  const soft = "var(--text-muted)";
  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block", maxWidth: "100%" }} role="img" aria-label="Piece drawing">
      <rect x={x} y={y} width={box.w} height={box.h} rx={3} fill={color ? `color-mix(in srgb, ${color} 30%, white)` : "var(--panel-muted)"} stroke={ink} strokeOpacity={0.6} strokeWidth={1.2} />
      {/* Its size: width along the bottom, height up its left. */}
      {wMm ? (
        <text x={x + box.w / 2} y={y + box.h + 17} textAnchor="middle" fontSize={12} fontWeight={600} fill={soft}>
          {Number(wMm.toFixed(1))}
        </text>
      ) : null}
      {hMm ? (
        <text x={x - 17} y={y + box.h / 2} textAnchor="middle" fontSize={12} fontWeight={600} fill={soft} transform={`rotate(-90 ${x - 17} ${y + box.h / 2})`}>
          {Number(hMm.toFixed(1))}
        </text>
      ) : null}
      {EDGE_KEYS.map((key) => {
        const side = edgeSide(key, tall);
        const edge = byKey.get(key);
        const mid = midOf(side, x, y, box.w, box.h);
        const horizontal = side === "top" || side === "bottom";
        const x1 = horizontal ? x : side === "left" ? x : x + box.w;
        const y1 = horizontal ? (side === "top" ? y : y + box.h) : y;
        const x2 = horizontal ? x + box.w : x1;
        const y2 = horizontal ? y1 : y + box.h;
        const different = edge && edge.tapeId;
        // (A different tape's name: outside its edge, across it — on the left, outside the height written there.)
        const labelX = side === "left" ? x - 40 : side === "right" ? x + box.w + 30 : mid.x;
        const labelY = side === "top" ? y - 26 : side === "bottom" ? y + box.h + 32 : mid.y;
        return (
          <g key={key}>
            {different ? <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ACCENT} strokeWidth={3.2} strokeLinecap="round" /> : null}
            {edge ? <Cross cx={mid.x} cy={mid.y} half={6} stroke={different ? ACCENT : ink} width={2} /> : null}
            {different ? (
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11.5}
                fontWeight={700}
                fill={ACCENT}
                transform={side === "left" || side === "right" ? `rotate(-90 ${labelX} ${labelY})` : undefined}
              >
                {nameOf(edge.tapeId)}
              </text>
            ) : null}
            {onEdgeClick ? (
              // (Something to click along the whole edge, wider than it looks.)
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="transparent"
                strokeWidth={22}
                style={{ cursor: "pointer" }}
                onClick={(event) => onEdgeClick(key, event)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onEdgeMenu?.(key, event);
                }}
              >
                <title>{edge ? "Click to unclash it · right-click for its edge tape" : "Click to clash it · right-click to pick its edge tape"}</title>
              </line>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function PieceEdgesZoom({
  height,
  width,
  edges,
  tapes,
  color,
  title,
  editable,
  onChange,
  onPickTape,
  onAddTape,
  defaultThicknessMm,
  size,
}: {
  height?: string;
  width?: string;
  edges: ResolvedEdge[];
  // The company's edge tapes, most picked first.
  tapes: PieceEdgeTapeOption[];
  color?: string;
  title?: string;
  editable?: boolean;
  // Its clashed edges after an edge's been changed in the pop-up (each one there clashed — "" the board's own tape).
  onChange?: (edges: RowEdges) => void;
  // A tape picked for an edge (its count of times picked goes up).
  onPickTape?: (tapeId: string) => void;
  // A new tape added from an edge's menu (its +): into the company's library — its id back (or the library's own, when
  // it already has one the same), for that edge.
  onAddTape?: (tape: { name: string; thicknessMm: number; widthMm: number }) => string;
  // What a new tape's Thickness starts as (mm) — the library's most used thickness.
  defaultThicknessMm?: string;
  size?: number;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [open, setOpen] = useState(false);
  // The edge whose menu is open in the pop-up (right-clicked), where it was right-clicked (on the screen), and what's been
  // typed in its search. Like every dropdown it floats over the page itself (portalled to <body>), so its glass looks
  // the same as theirs — inside the pop-up, its blur would only see the pop-up.
  const [menu, setMenu] = useState<{ key: EdgeKey; x: number; y: number } | null>(null);
  const menuOpenRef = useRef(false);
  useEffect(() => {
    menuOpenRef.current = Boolean(menu);
  }, [menu]);
  const closeMenu = useCallback(() => setMenu(null), []);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLButtonElement | null>(null);
  const growFromRef = useRef<{ box: DOMRect; fromPreview: boolean } | null>(null);
  const closingRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);
  const popupTitle = String(title ?? "").trim() || "Edges";
  const canEdit = Boolean(editable && onChange);

  useLayoutEffect(() => {
    const preview = previewRef.current;
    if (!preview || !anchor) return;
    const boxW = preview.offsetWidth;
    const boxH = preview.offsetHeight;
    const above = anchor.top - PREVIEW_GAP_PX - boxH;
    const below = anchor.bottom + PREVIEW_GAP_PX;
    const placeAbove = above >= SCREEN_EDGE_PX || below + boxH > window.innerHeight - SCREEN_EDGE_PX;
    const top = placeAbove ? Math.max(SCREEN_EDGE_PX, above) : below;
    const centred = anchor.left + anchor.width / 2 - boxW / 2;
    const left = Math.min(window.innerWidth - boxW - SCREEN_EDGE_PX, Math.max(SCREEN_EDGE_PX, centred));
    const originX = Math.min(boxW, Math.max(0, anchor.left + anchor.width / 2 - left));
    preview.style.top = `${top}px`;
    preview.style.left = `${left}px`;
    preview.style.transformOrigin = `${Math.round(originX)}px ${placeAbove ? "100%" : "0%"}`;
    preview.style.visibility = "visible";
  }, [anchor, height, width, edges]);

  const cancelHide = () => {
    if (hideTimerRef.current === null) return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  };
  const hideSoon = () => {
    cancelHide();
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setAnchor(null);
    }, HOVER_GRACE_MS);
  };
  useEffect(
    () => () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    },
    [],
  );
  const openFrom = (box: DOMRect, fromPreview: boolean) => {
    cancelHide();
    growFromRef.current = { box, fromPreview };
    setAnchor(null);
    setMenu(null);
    setOpen(true);
  };
  useEffect(() => {
    if (!anchor) return;
    const hide = () => setAnchor(null);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", hide, { capture: true });
  }, [anchor]);

  useLayoutEffect(() => {
    if (!open) return;
    const from = growFromRef.current;
    growFromRef.current = null;
    const panel = panelRef.current;
    if (!from || !canMorph(panel)) return;
    const to = panel.getBoundingClientRect();
    if (!to.width || !to.height || !from.box.width || !from.box.height) return;
    panel.animate(
      [
        { transform: overBox(from.box, to), opacity: from.fromPreview ? 1 : 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: GROW_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [open]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    setMenu(null);
    const finish = () => {
      closingRef.current = false;
      setOpen(false);
    };
    const panel = panelRef.current;
    const target = buttonRef.current?.getBoundingClientRect();
    if (!canMorph(panel) || !target || !target.width || !target.height) {
      finish();
      return;
    }
    closingRef.current = true;
    const to = panel.getBoundingClientRect();
    const shrink = panel.animate(
      [
        { transform: "none", opacity: 1 },
        { transform: overBox(target, to), opacity: 0 },
      ],
      { duration: SHRINK_MS, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
    );
    backdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SHRINK_MS, easing: "ease-in", fill: "forwards" });
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      finish();
    };
    shrink.finished.then(once, once);
    window.setTimeout(once, SHRINK_MS + 120);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      // (An edge's menu open: that handles it — EdgeTapeMenu.)
      if (menuOpenRef.current) return;
      close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, close]);

  // An edge changed: clashed on the board's own tape ("") or a library tape, or unclashed (null).
  const setEdge = (key: EdgeKey, tapeId: string | null) => {
    if (!onChange) return;
    const next: RowEdges = Object.fromEntries(edges.map((edge) => [edge.key, edge.tapeId]));
    if (tapeId === null) delete next[key];
    else next[key] = tapeId;
    onChange(next);
    if (tapeId) onPickTape?.(tapeId);
    setMenu(null);
  };
  // Clicked: clashed on the board's own tape (Matching) straight away — or, clashed already, unclashed.
  const onEdgeClick = (key: EdgeKey) => {
    setMenu(null);
    setEdge(key, edges.some((edge) => edge.key === key) ? null : "");
  };
  // Right-clicked: its menu — a search, Matching and the company's edge tapes, and No clashing when it's clashed.
  const onEdgeMenu = (key: EdgeKey, event: React.MouseEvent<SVGElement>) => {
    setMenu({ key, x: event.clientX, y: event.clientY });
  };

  const screenH = typeof window === "undefined" ? 800 : window.innerHeight;
  const screenW = typeof window === "undefined" ? 1200 : window.innerWidth;
  const popupBox = { width: Math.min(560, Math.max(260, screenW - 120)), height: Math.min(480, Math.max(240, screenH - 260)) };
  const current = menu ? edges.find((edge) => edge.key === menu.key) : undefined;
  const hMm = mmOf(height);
  const wMm = mmOf(width);
  const tall = hMm > wMm;
  const sideWord: Record<EdgeSide, string> = { top: "Top edge", bottom: "Bottom edge", left: "Left edge", right: "Right edge" };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        tabIndex={-1}
        aria-label={canEdit ? "Open the piece drawing to change its edges" : "Enlarge the piece drawing"}
        className="inline-flex shrink-0 cursor-zoom-in rounded-[4px]"
        onPointerEnter={(event) => {
          cancelHide();
          if (event.pointerType === "mouse") setAnchor(event.currentTarget.getBoundingClientRect());
        }}
        onPointerLeave={hideSoon}
        onClick={(event) => {
          event.stopPropagation();
          const preview = previewRef.current;
          if (anchor && preview) openFrom(preview.getBoundingClientRect(), true);
          else openFrom(event.currentTarget.getBoundingClientRect(), false);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <PieceEdgesDiagram height={height} width={width} edges={edges} color={color} size={size} />
      </button>
      {anchor && !open
        ? createPortal(
            <div
              ref={previewRef}
              aria-hidden="true"
              className="glass-menu-squeeze fixed left-0 top-0 cursor-zoom-in rounded-[14px] border p-2"
              onPointerEnter={cancelHide}
              onPointerLeave={hideSoon}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                openFrom(event.currentTarget.getBoundingClientRect(), true);
              }}
              style={{
                visibility: "hidden",
                zIndex: 2147483645,
                maxWidth: `calc(100vw - ${SCREEN_EDGE_PX * 2}px)`,
                borderColor: "var(--glass-border)",
                backgroundColor: "var(--glass-modal-bg)",
                backdropFilter: "blur(12px) saturate(220%)",
                WebkitBackdropFilter: "blur(12px) saturate(220%)",
                boxShadow: "inset 0 0 0 999px color-mix(in srgb, var(--panel-bg) 22%, transparent), var(--shadow-glass)",
              }}
            >
              <PieceEdgesMeasured height={height} width={width} edges={edges} tapes={tapes} color={color} boxWidth={PREVIEW_BOX.width} boxHeight={PREVIEW_BOX.height} />
            </div>,
            document.body,
          )
        : null}
      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-[2147483646] flex items-center justify-center px-4"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <button ref={backdropRef} type="button" aria-label="Close piece drawing backdrop" onClick={close} className="glass-modal-backdrop absolute inset-0" />
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={popupTitle}
                className="glass-modal-panel relative flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden"
              >
                <GlassModalHeader title={popupTitle} onClose={close} />
                <div ref={bodyRef} className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pb-5 pt-1" onClick={() => setMenu(null)}>
                  <div onClick={(event) => event.stopPropagation()}>
                    <PieceEdgesMeasured
                      height={height}
                      width={width}
                      edges={edges}
                      tapes={tapes}
                      color={color}
                      boxWidth={popupBox.width}
                      boxHeight={popupBox.height}
                      onEdgeClick={canEdit ? onEdgeClick : undefined}
                      onEdgeMenu={canEdit ? onEdgeMenu : undefined}
                    />
                  </div>
                  <p className="mt-2 text-center text-[12.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                    {canEdit
                      ? "Click an edge to clash it (Matching) or unclash it. Right-click an edge to pick its edge tape."
                      : edges.length
                        ? "An X marks each clashed edge."
                        : "No clashed edges."}
                  </p>
                  {menu ? (
                    <EdgeTapeMenu
                      key={`${menu.key}_${menu.x}_${menu.y}`}
                      at={{ x: menu.x, y: menu.y }}
                      label={sideWord[edgeSide(menu.key, tall)]}
                      options={[{ id: "", label: "Matching" }, ...tapes.map((tape) => ({ id: tape.id, label: tape.label }))]}
                      selectedId={current ? current.tapeId : null}
                      onPick={(tapeId) => setEdge(menu.key, tapeId)}
                      onClose={closeMenu}
                      onAddTape={onAddTape}
                      defaultThicknessMm={defaultThicknessMm}
                      clearLabel={current ? "No clashing" : undefined}
                      onClear={current ? () => setEdge(menu.key, null) : undefined}
                    />
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
