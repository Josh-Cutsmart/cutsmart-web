"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DoorHingeDiagram, DoorHingeMeasured, type DoorHingeSide } from "@/components/door-hinge-diagram";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { evaluateDimensionMath } from "@/lib/dimension-math";

// A door's small drawing that can be looked at closer once it has hinge positions: pointed at, a bigger one with each hinge's
// measurement springs out of it, as a dropdown menu does, and stays while the mouse is on either of them; clicked (the
// drawing or the bigger one), that one grows into a pop-up in the middle of the screen (titled with the part's name, when
// it has one), and shrinks back into the drawing as it closes. Both are marked Front, the side the hinges are measured on.
// With no positions yet, just the small drawing.

const PREVIEW_DOOR = { width: 240, height: 260 };
const PREVIEW_GAP_PX = 10;
const SCREEN_EDGE_PX = 8;
const GROW_MS = 340;
const SHRINK_MS = 220;
// Time to get from the drawing to the bigger one (across the gap between them) before it goes.
const HOVER_GRACE_MS = 160;
// (On a phone the pop-up is a sheet up from the bottom, with its own way in — app/globals.css, .glass-modal-panel.)
const PHONE_SHEET_QUERY = "(max-width: 639.98px)";

function hasPosition(values: string[]): boolean {
  return values.some((value) => {
    const text = String(value ?? "").trim();
    return Number.parseFloat(evaluateDimensionMath(text) ?? text) >= 0;
  });
}

// The pop-up drawn over `from`'s box: moved and squashed there from its own (`to`).
function overBox(from: DOMRect, to: DOMRect): string {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${Math.max(0.05, from.width / to.width)}, ${Math.max(0.05, from.height / to.height)})`;
}

// Growing and shrinking: not on a phone (its sheet), nor for someone who's asked for less motion.
function canMorph(element: HTMLElement | null): element is HTMLElement {
  return (
    !!element &&
    typeof element.animate === "function" &&
    !window.matchMedia(PHONE_SHEET_QUERY).matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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
  title,
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
  // The pop-up's title: the part's name, if it has one.
  title?: string;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLButtonElement | null>(null);
  // What the pop-up grows out of: the floating one if it was showing, or the small drawing.
  const growFromRef = useRef<{ box: DOMRect; fromPreview: boolean } | null>(null);
  const closingRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);
  const small = <DoorHingeDiagram height={height} width={width} up={up} down={down} side={side} color={color} maxWidth={maxWidth} maxHeight={maxHeight} maxGrowWidth={maxGrowWidth} />;
  const measured = { height, width, up, down, side };
  const popupTitle = String(title ?? "").trim() || "Door hinges";

  // The floating one: over the drawing, or under it if there isn't the room, and kept on the screen. It springs out of
  // the edge nearest the drawing (.glass-menu-squeeze, the dropdowns' — transform-origin set here), across where the
  // drawing is. (offsetWidth/Height: its own size, not the squashed one it starts at.)
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
  }, [anchor, height, width, up, down, side]);

  // The mouse off the drawing and the bigger one: it goes, after a moment (coming back onto either keeps it).
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
    setOpen(true);
  };

  // Gone as the page moves: it would be left behind.
  useEffect(() => {
    if (!anchor) return;
    const hide = () => setAnchor(null);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", hide, { capture: true });
  }, [anchor]);

  // Opening: the pop-up starts as the box it grows out of and grows to its own place in the middle.
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

  // Closing: back into the small drawing as the backdrop fades, then gone.
  const close = useCallback(() => {
    if (closingRef.current) return;
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
    // (In case the animation never reports back — a tab in the background.)
    window.setTimeout(once, SHRINK_MS + 120);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, close]);

  if (!hasPosition(up) && !hasPosition(down)) return small;
  // (Pop-up size: as much of the screen as it can have, under its header and caption.)
  const screenH = typeof window === "undefined" ? 800 : window.innerHeight;
  const screenW = typeof window === "undefined" ? 1200 : window.innerWidth;
  const popupDoor = { height: Math.min(560, Math.max(220, screenH - 220)), width: Math.min(560, Math.max(200, screenW - 200)) };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        // Not a stop on the way through the Entry's boxes by Tab.
        tabIndex={-1}
        aria-label="Enlarge the door drawing"
        className="inline-flex shrink-0 cursor-zoom-in rounded-[4px]"
        onPointerEnter={(event) => {
          cancelHide();
          if (event.pointerType === "mouse") setAnchor(event.currentTarget.getBoundingClientRect());
        }}
        onPointerLeave={hideSoon}
        onClick={(event) => {
          const preview = previewRef.current;
          if (anchor && preview) openFrom(preview.getBoundingClientRect(), true);
          else openFrom(event.currentTarget.getBoundingClientRect(), false);
        }}
      >
        {small}
      </button>
      {anchor && !open
        ? createPortal(
            <div
              ref={previewRef}
              // (The mouse's way to it; the drawing's button is everyone's.)
              aria-hidden="true"
              className="glass-menu-squeeze fixed left-0 top-0 cursor-zoom-in rounded-[14px] border p-3"
              onPointerEnter={cancelHide}
              onPointerLeave={hideSoon}
              // (Stopped here, as the pop-up's: a click in a portal still reaches the drawing's row.)
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                openFrom(event.currentTarget.getBoundingClientRect(), true);
              }}
              style={{
                visibility: "hidden",
                // (Over any pop-up the drawing's in — Edit piece's — though under its own.)
                zIndex: 2147483645,
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
              <button ref={backdropRef} type="button" aria-label="Close door drawing backdrop" onClick={close} className="glass-modal-backdrop absolute inset-0" />
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={popupTitle}
                className="glass-modal-panel relative flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden"
              >
                <GlassModalHeader title={popupTitle} onClose={close} />
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
