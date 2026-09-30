"use client";

import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject, type TouchEvent as ReactTouchEvent } from "react";

type DragState = {
  startY: number;
  dragging: boolean;
  panelHeight: number;
  lastY: number;
  lastT: number;
  velocity: number;
};

const SHEET_DURATION_MS = 280;
const SHEET_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const CLOSED_TRANSFORM = "translateY(100%)";

// A bottom sheet that slides up from below a mobile-only trigger bar to flush against the top of
// the screen, and drags back down to close via its own header — the exact mechanics of Nesting's
// own mobile Visibility overlay (the pattern this was extracted from), parameterized so any other
// mobile action bar (Quote, Specifications) can share the same touch/transform plumbing instead of
// re-implementing it per instance.
//
// Opening is tap-only (no drag-up) — on iPhone the trigger bar sits right where the OS's own
// "swipe up from the bottom edge to leave the app" gesture lives, so a drag-to-open there kept
// getting eaten by iOS instead of opening the panel. Closing (dragging the panel's own header
// down) doesn't have that conflict, so it keeps its drag/fling gesture — tracks velocity
// (lastY/lastT) alongside plain drag distance so a fast downward flick commits to closing even
// released well short of the halfway point ("throw it down"), instead of requiring the drag to be
// carried all the way.
export function useMobileBottomSheet(isCompactViewport: boolean): {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  panelRef: RefObject<HTMLDivElement | null>;
  onHeaderClick: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onHeaderTouchStart: (e: ReactTouchEvent<HTMLDivElement>) => void;
  onHeaderTouchMove: (e: ReactTouchEvent<HTMLDivElement>) => void;
  onHeaderTouchEnd: () => void;
} {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>({ startY: 0, dragging: false, panelHeight: 0, lastY: 0, lastT: 0, velocity: 0 });

  // Runs before paint so the panel's very first render is already off-screen, not a visible flash
  // of "open" before this effect gets a chance to hide it. Owns every non-drag transition (the
  // touch handlers below write the same transform imperatively for 1:1 drag tracking instead).
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.transition = `transform ${SHEET_DURATION_MS}ms ${SHEET_EASING}`;
    panel.style.transform = isOpen ? "translateY(0px)" : CLOSED_TRANSFORM;
    // isCompactViewport: the panel only mounts (and panelRef only populates) once the viewport is
    // compact, which can happen well after the initial isOpen value was set — re-running this
    // effect on that transition is what actually applies the closed position to a freshly-mounted
    // panel rather than leaving it at its unstyled default.
  }, [isOpen, isCompactViewport]);

  // Only closes for a tap on the header's own background — e.target === e.currentTarget is true
  // only when nothing else (a button, an input) inside the header was actually hit.
  const onHeaderClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    setIsOpen(false);
  };

  const onHeaderTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    const panel = panelRef.current;
    if (!touch || !panel || !isOpen) return;
    // Same identity check as onHeaderClick — see its own comment.
    if (e.target !== e.currentTarget) return;
    dragRef.current = {
      startY: touch.clientY,
      dragging: true,
      panelHeight: panel.getBoundingClientRect().height || 1,
      lastY: touch.clientY,
      lastT: e.timeStamp,
      velocity: 0,
    };
  };

  const onHeaderTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const touch = e.touches[0];
    const panel = panelRef.current;
    if (!drag.dragging || !touch || !panel) return;
    const dy = touch.clientY - drag.startY;
    if (dy <= 0) return;
    if (dy < 6) return;
    e.preventDefault();
    const progress = Math.min(1, dy / drag.panelHeight);
    panel.style.transition = "none";
    panel.style.transform = `translateY(${progress * drag.panelHeight}px)`;
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.velocity = (touch.clientY - drag.lastY) / dt;
    drag.lastY = touch.clientY;
    drag.lastT = e.timeStamp;
  };

  const onHeaderTouchEnd = () => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag.dragging) return;
    drag.dragging = false;
    if (!panel) return;
    const match = /translateY\(([-\d.]+)px\)/.exec(panel.style.transform);
    const currentPx = match ? Number.parseFloat(match[1]) : 0;
    const progress = drag.panelHeight > 0 ? currentPx / drag.panelHeight : 0;
    if (progress > 0.35 || drag.velocity > 0.5) {
      setIsOpen(false);
      return;
    }
    panel.style.transition = `transform ${SHEET_DURATION_MS}ms ${SHEET_EASING}`;
    panel.style.transform = "translateY(0px)";
  };

  return { isOpen, setIsOpen, panelRef, onHeaderClick, onHeaderTouchStart, onHeaderTouchMove, onHeaderTouchEnd };
}
