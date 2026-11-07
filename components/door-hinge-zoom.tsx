"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DoorHingeDiagram, DoorHingeMeasured, type DoorHingeSide } from "@/components/door-hinge-diagram";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { evaluateDimensionMath } from "@/lib/dimension-math";

// A door's small drawing that can be looked at closer once it has hinge positions: pointed at, a bigger one with each hinge's
// measurement floats by it; clicked, bigger again in a pop-up. Both are marked Front, the side the hinges are measured on.
// With no positions yet, just the small drawing.

const PREVIEW_DOOR = { width: 240, height: 260 };
const PREVIEW_GAP_PX = 10;
const SCREEN_EDGE_PX = 8;

function hasPosition(values: string[]): boolean {
  return values.some((value) => {
    const text = String(value ?? "").trim();
    return Number.parseFloat(evaluateDimensionMath(text) ?? text) >= 0;
  });
}

export function DoorHingeZoom({
  height,
  width,
  up,
  down,
  side,
  color,
  maxWidth,
  maxHeight,
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
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [open, setOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const small = <DoorHingeDiagram height={height} width={width} up={up} down={down} side={side} color={color} maxWidth={maxWidth} maxHeight={maxHeight} maxGrowWidth={maxGrowWidth} />;
  const measured = { height, width, up, down, side };

  // The floating one: over the drawing, or under it if there isn't the room, and kept on the screen.
  useLayoutEffect(() => {
    const preview = previewRef.current;
    if (!preview || !anchor) return;
    const box = preview.getBoundingClientRect();
    const above = anchor.top - PREVIEW_GAP_PX - box.height;
    const below = anchor.bottom + PREVIEW_GAP_PX;
    const top = above >= SCREEN_EDGE_PX || below + box.height > window.innerHeight - SCREEN_EDGE_PX ? Math.max(SCREEN_EDGE_PX, above) : below;
    const centred = anchor.left + anchor.width / 2 - box.width / 2;
    preview.style.top = `${top}px`;
    preview.style.left = `${Math.min(window.innerWidth - box.width - SCREEN_EDGE_PX, Math.max(SCREEN_EDGE_PX, centred))}px`;
    preview.style.visibility = "visible";
  }, [anchor, height, width, up, down, side]);

  // Gone as the page moves: it would be left behind.
  useEffect(() => {
    if (!anchor) return;
    const hide = () => setAnchor(null);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", hide, { capture: true });
  }, [anchor]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  if (!hasPosition(up) && !hasPosition(down)) return small;
  // (Pop-up size: as much of the screen as it can have, under its header and caption.)
  const screenH = typeof window === "undefined" ? 800 : window.innerHeight;
  const screenW = typeof window === "undefined" ? 1200 : window.innerWidth;
  const popupDoor = { height: Math.min(560, Math.max(220, screenH - 220)), width: Math.min(560, Math.max(200, screenW - 200)) };

  return (
    <>
      <button
        type="button"
        // Not a stop on the way through the Entry's boxes by Tab.
        tabIndex={-1}
        aria-label="Enlarge the door drawing"
        className="inline-flex shrink-0 cursor-zoom-in rounded-[4px]"
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setAnchor(event.currentTarget.getBoundingClientRect());
        }}
        onPointerLeave={() => setAnchor(null)}
        onClick={() => {
          setAnchor(null);
          setOpen(true);
        }}
      >
        {small}
      </button>
      {anchor && !open
        ? createPortal(
            <div
              ref={previewRef}
              aria-hidden="true"
              className="pointer-events-none fixed left-0 top-0 rounded-[14px] border p-3"
              style={{
                visibility: "hidden",
                zIndex: 2147483000,
                maxWidth: `calc(100vw - ${SCREEN_EDGE_PX * 2}px)`,
                borderColor: "var(--glass-border)",
                backgroundColor: "var(--glass-modal-bg)",
                backdropFilter: "blur(12px) saturate(220%)",
                WebkitBackdropFilter: "blur(12px) saturate(220%)",
                boxShadow: "inset 0 0 0 999px color-mix(in srgb, var(--panel-bg) 22%, transparent), var(--shadow-glass)",
              }}
            >
              <DoorHingeMeasured {...measured} doorMaxWidth={PREVIEW_DOOR.width} doorMaxHeight={PREVIEW_DOOR.height} />
            </div>,
            document.body,
          )
        : null}
      {open
        ? createPortal(
            // (Stopped here: a click in a portal still reaches what's round the drawing, its row in the Entry.)
            <div
              className="fixed inset-0 z-[2147483646] flex items-center justify-center px-4"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <button type="button" aria-label="Close door drawing backdrop" onClick={() => setOpen(false)} className="glass-modal-backdrop absolute inset-0" />
              <div role="dialog" aria-modal="true" aria-label="Door hinges" className="glass-modal-panel relative flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden">
                <GlassModalHeader title="Door hinges" onClose={() => setOpen(false)} />
                <div className="glass-scroll flex min-h-0 flex-1 justify-center overflow-y-auto px-5 pb-5 pt-1">
                  <DoorHingeMeasured {...measured} doorMaxWidth={popupDoor.width} doorMaxHeight={popupDoor.height} large />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
