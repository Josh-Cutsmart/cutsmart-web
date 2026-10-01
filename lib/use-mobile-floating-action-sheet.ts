"use client";

import { useLayoutEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";

const SHEET_DURATION_MS = 280;
const SHEET_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

type DragState = {
  startY: number;
  dragging: boolean;
  // Total travel distance (px) from fully open to fully closed — the panel's own measured height
  // PLUS closedOffsetPx (see the hook's own param comment), not just the panel's height alone.
  // Using this (not a raw % of the panel's own box) is what makes closedOffsetPx correct for a
  // live drag too, not just the resting open/closed states the layout effect sets.
  travelPx: number;
  lastY: number;
  lastT: number;
  velocity: number;
};

// A floating action sheet for mobile: a small, auto-height card of stacked buttons that rises up
// from just above a FIXED trigger bar (the trigger itself never moves or hides — see the host's
// own JSX), backed by a blurred/dimmed backdrop that fades in and out with it. Deliberately NOT
// useMobileBottomSheet (the full-screen slide-up this replaces for Quote/Specs' own "Actions"
// trigger, still used as-is by Nesting/CNC's own Visibility panel) — every dimension of the
// mechanics differs: height is auto (however tall the button list needs, never full screen), there
// IS a real backdrop (useMobileBottomSheet has none), and the close-drag works from anywhere across
// the open sheet's whole surface (backdrop included) rather than being scoped to one drag handle —
// this panel has no header to scope it to, just its list of buttons.
//
// closedOffsetPx: how far ABOVE the sheet's own positioned container's bottom edge the panel sits
// at rest (e.g. the host positions it with `bottom: 68px` so it floats just above a docked trigger
// bar, instead of flush at the container's true bottom). A plain translateY(100%) only ever moves
// an element by its OWN height — it has no idea the panel was already offset upward by another
// 68px before that, so "closed" left it still 68px short of actually being off-screen, visibly
// poking up above the trigger bar even at rest. Every pixel math in this hook adds this offset to
// the panel's own measured height to get the TRUE closed travel distance. Defaults to 0 (flush at
// the container's bottom — plain translateY(100%) is already exactly correct in that case).
export function useMobileFloatingActionSheet(
  isCompactViewport: boolean,
  closedOffsetPx = 0,
): {
  isOpen: boolean;
  // True for exactly SHEET_DURATION_MS right after an open→close transition starts, then false
  // again — a one-shot window for the host to play a "pop away" exit on its own buttons (matching
  // FloatingBarSlot's own identical pop-away for a button leaving the desktop bar) in sync with the
  // panel's own slide-down, rather than just going slack/limp as the panel carries them off-screen.
  isClosing: boolean;
  setIsOpen: (open: boolean) => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
  backdropRef: React.RefObject<HTMLDivElement | null>;
  onBackdropClick: () => void;
  dragHandlers: {
    onTouchStart: (e: ReactTouchEvent<HTMLElement>) => void;
    onTouchMove: (e: ReactTouchEvent<HTMLElement>) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
} {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>({ startY: 0, dragging: false, travelPx: 0, lastY: 0, lastT: 0, velocity: 0 });
  const wasOpenRef = useRef(false);
  const hideTimeoutRef = useRef<number | null>(null);

  // Runs before paint, same reasoning as useMobileBottomSheet's own identical effect — the panel's
  // very first render is already off-screen, not a visible flash of "open" before this gets a
  // chance to hide it. Measures the panel's OWN current height fresh every time (its content, and
  // so its height, can change between opens) rather than caching it once.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel) return;
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    const travelPx = panel.getBoundingClientRect().height + closedOffsetPx;
    panel.style.transition = `transform ${SHEET_DURATION_MS}ms ${SHEET_EASING}`;
    panel.style.transform = isOpen ? "translateY(0px)" : `translateY(${travelPx}px)`;
    // A real mobile-only bug (never reproduced on desktop or in dev-tools emulation) occasionally
    // left a sliver of the topmost button (farthest from the trigger bar) visibly poking out and
    // overlapping the fixed "Actions" trigger bar underneath, even while the sheet was supposed to
    // be fully closed — i.e. travelPx above came up short of the real distance needed to push the
    // panel fully off-screen. `visibility: hidden` is a hard backstop against that: unlike the
    // transform-based slide (only ever as reliable as its height measurement), it removes the panel
    // from paint and hit-testing entirely regardless of whatever its transform currently says, so a
    // mismeasured travelPx can no longer leave anything visible at rest. Delayed by
    // SHEET_DURATION_MS on an open→close transition so the slide-down (and the host's own
    // isClosing-driven button pop-away, timed well within that same window) plays in full first;
    // applied immediately on first mount or any other already-closed render, since there's no close
    // transition to show.
    // setIsClosing is never called directly here — react-hooks/set-state-in-effect flags a
    // synchronous setState call sitting straight in an effect body (it can cascade an extra render
    // for no visible benefit, since nothing here depends on the previous render having committed
    // first). queueMicrotask defers each call by one tick, same as FloatingBarSlot's own identical
    // setState calls above are ALWAYS wrapped in a requestAnimationFrame/setTimeout rather than
    // called bare — still resolves before the browser paints, so it's imperceptible.
    if (isOpen) {
      panel.style.visibility = "visible";
      queueMicrotask(() => setIsClosing(false));
    } else if (wasOpenRef.current) {
      queueMicrotask(() => setIsClosing(true));
      hideTimeoutRef.current = window.setTimeout(() => {
        panel.style.visibility = "hidden";
        setIsClosing(false);
        hideTimeoutRef.current = null;
      }, SHEET_DURATION_MS);
    } else {
      panel.style.visibility = "hidden";
      queueMicrotask(() => setIsClosing(false));
    }
    wasOpenRef.current = isOpen;
    if (backdrop) {
      backdrop.style.transition = `opacity ${SHEET_DURATION_MS}ms ease`;
      backdrop.style.opacity = isOpen ? "1" : "0";
      backdrop.style.pointerEvents = isOpen ? "auto" : "none";
    }
    return () => {
      if (hideTimeoutRef.current !== null) {
        window.clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };
  }, [isOpen, isCompactViewport, closedOffsetPx]);

  const onBackdropClick = () => setIsOpen(false);

  // Starts tracking a close-drag from ANY touch within the open sheet — backdrop or panel alike,
  // matching "sliding down anywhere on the screen" closes it. The 6px-of-movement gate in
  // onTouchMove below (before anything actually happens) is what keeps this from swallowing a
  // plain tap on one of the panel's own buttons.
  const onTouchStart = (e: ReactTouchEvent<HTMLElement>) => {
    const touch = e.touches[0];
    const panel = panelRef.current;
    if (!touch || !panel || !isOpen) return;
    dragRef.current = {
      startY: touch.clientY,
      dragging: true,
      travelPx: panel.getBoundingClientRect().height + closedOffsetPx || 1,
      lastY: touch.clientY,
      lastT: e.timeStamp,
      velocity: 0,
    };
  };

  const onTouchMove = (e: ReactTouchEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const touch = e.touches[0];
    const panel = panelRef.current;
    if (!drag.dragging || !touch || !panel) return;
    const dy = touch.clientY - drag.startY;
    if (dy <= 0) return;
    if (dy < 6) return;
    e.preventDefault();
    const clampedDy = Math.min(dy, drag.travelPx);
    panel.style.transition = "none";
    panel.style.transform = `translateY(${clampedDy}px)`;
    const backdrop = backdropRef.current;
    if (backdrop) {
      backdrop.style.transition = "none";
      backdrop.style.opacity = String(1 - clampedDy / drag.travelPx);
    }
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.velocity = (touch.clientY - drag.lastY) / dt;
    drag.lastY = touch.clientY;
    drag.lastT = e.timeStamp;
  };

  const onTouchEnd = () => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag.dragging) return;
    drag.dragging = false;
    if (!panel) return;
    const match = /translateY\(([-\d.]+)px\)/.exec(panel.style.transform);
    const currentPx = match ? Number.parseFloat(match[1]) : 0;
    const progress = drag.travelPx > 0 ? currentPx / drag.travelPx : 0;
    if (progress > 0.35 || drag.velocity > 0.5) {
      setIsOpen(false);
      return;
    }
    panel.style.transition = `transform ${SHEET_DURATION_MS}ms ${SHEET_EASING}`;
    panel.style.transform = "translateY(0px)";
    const backdrop = backdropRef.current;
    if (backdrop) {
      backdrop.style.transition = `opacity ${SHEET_DURATION_MS}ms ease`;
      backdrop.style.opacity = "1";
    }
  };

  return { isOpen, isClosing, setIsOpen, panelRef, backdropRef, onBackdropClick, dragHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd } };
}
