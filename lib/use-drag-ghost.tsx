"use client";

import { createPortal, flushSync } from "react-dom";
import { forwardRef, useImperativeHandle, useRef, useState, type RefObject } from "react";

// Reusable "grab and swing" drag-ghost effect, extracted from the Sales Items
// board so any draggable list (lead board cards, item library rows, etc.) can
// share it: a custom floating pill follows the cursor in place of the
// browser's native drag image, growing out of the dragged element on pick-up
// and tilting side-to-side (a pendulum "swing") as it's moved horizontally.

export type DragGhostContent = { label: string; color: string } | null;

type DragGhostHandle = {
  getEl: () => HTMLDivElement | null;
  setContent: (content: DragGhostContent) => void;
};

const DragGhostPill = forwardRef<DragGhostHandle>(function DragGhostPill(_props, ref) {
  const [content, setContent] = useState<DragGhostContent>(null);
  const elRef = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => ({ getEl: () => elRef.current, setContent }), []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={elRef}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[2147483647] flex items-center gap-2 rounded-[10px] border px-3 py-2"
      style={{
        opacity: 0,
        borderColor: "var(--glass-border)",
        backgroundColor: "var(--glass-modal-bg)",
        backdropFilter: "blur(12px) saturate(220%)",
        WebkitBackdropFilter: "blur(12px) saturate(220%)",
        boxShadow: "var(--shadow-glass)",
        transition: "opacity 150ms ease-out",
        willChange: "transform",
      }}
    >
      {content ? (
        <>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: content.color }} />
          <span className="whitespace-nowrap text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>{content.label}</span>
        </>
      ) : null}
    </div>,
    document.body,
  );
});

export type DragGhostController = {
  ghostRef: RefObject<DragGhostHandle | null>;
  transparentImageRef: RefObject<HTMLDivElement | null>;
  // Call from onDragStart, after event.dataTransfer.setDragImage(transparentImageRef.current, 0, 0).
  // `originElId` is the id of the on-screen element the ghost should visibly
  // grow out of (the FLIP "pick-up" pop); falls back to growing in place if
  // that element can't be found.
  spawn: (event: { clientX: number; clientY: number }, originElId: string, content: { label: string; color: string }) => void;
  // Call from onDragEnd.
  end: () => void;
};

// Native drag fires `dragover` almost immediately and continuously, often at
// essentially the same spot the drag started — cancelling the pickup
// animation on literally the first one of those (any dragover at all) meant
// the grow animation never survived long enough to be seen. Only cancel it
// once the cursor has genuinely moved away from the pickup point, so a slow/
// deliberate pickup still gets the full visible pop, while a real fast drag
// still switches to instant tracking without lag.
const DRAG_GHOST_MOVE_CANCEL_PX = 12;

export function useDragGhost(): DragGhostController {
  const ghostRef = useRef<DragGhostHandle>(null);
  const lastXRef = useRef(0);
  const startPointRef = useRef({ x: 0, y: 0 });
  const growFrameRef = useRef<number | null>(null);
  const settleCleanupRef = useRef<(() => void) | null>(null);
  const transparentImageRef = useRef<HTMLDivElement | null>(null);
  const dragOverListenerRef = useRef((event: DragEvent) => {
    const ghost = ghostRef.current?.getEl();
    if (!ghost) return;
    const x = event.clientX;
    const y = event.clientY;
    if (x === 0 && y === 0) return;
    if (growFrameRef.current !== null || settleCleanupRef.current) {
      const movedPx = Math.hypot(x - startPointRef.current.x, y - startPointRef.current.y);
      if (movedPx > DRAG_GHOST_MOVE_CANCEL_PX) {
        if (growFrameRef.current !== null) {
          cancelAnimationFrame(growFrameRef.current);
          growFrameRef.current = null;
        }
        if (settleCleanupRef.current) {
          settleCleanupRef.current();
          settleCleanupRef.current = null;
        }
        ghost.style.transition = "none";
        ghost.style.transformOrigin = "center";
      }
    }
    const dx = x - lastXRef.current;
    lastXRef.current = x;
    const rotation = Math.max(-18, Math.min(18, dx * 1.6));
    ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, 6px) rotate(${rotation}deg)`;
  });

  const clearPendingGrow = () => {
    if (growFrameRef.current !== null) {
      cancelAnimationFrame(growFrameRef.current);
      growFrameRef.current = null;
    }
    if (settleCleanupRef.current) {
      settleCleanupRef.current();
      settleCleanupRef.current = null;
    }
  };

  const spawn: DragGhostController["spawn"] = (event, originElId, content) => {
    clearPendingGrow();
    lastXRef.current = event.clientX;
    startPointRef.current = { x: event.clientX, y: event.clientY };
    const handle = ghostRef.current;
    if (!handle) return;
    flushSync(() => handle.setContent(content));
    const ghost = handle.getEl();
    if (!ghost) return;
    // Snap the ghost onto the origin element's box immediately, with no
    // transition — this part just needs to happen before paint, not animate.
    ghost.style.transition = "none";
    ghost.style.transformOrigin = "top left";
    ghost.style.transform = "none";
    const naturalRect = ghost.getBoundingClientRect();
    const originEl = typeof document !== "undefined" ? document.getElementById(originElId) : null;
    const originRect = originEl ? originEl.getBoundingClientRect() : naturalRect;
    const scaleX = naturalRect.width > 0 ? Math.max(originRect.width, 1) / naturalRect.width : 1;
    const scaleY = naturalRect.height > 0 ? Math.max(originRect.height, 1) / naturalRect.height : 1;
    ghost.style.transform = `translate(${originRect.left}px, ${originRect.top}px) scale(${scaleX}, ${scaleY})`;
    ghost.style.opacity = "1";
    // The actual grow-to-cursor transition is deferred to the next frame
    // instead of forced via offsetWidth in this same tick — dragstart also
    // has to synchronously hand the browser its native drag image/session,
    // and starting a CSS transition in that same contended tick is what made
    // the grow animation look laggy/stuttery. Giving it a clean frame of its
    // own fixes that. Settling (dropping the transition so `dragover`'s
    // per-frame rotation writes aren't fighting an active transition) waits
    // for the real `transitionend` event rather than a fixed timer, so it
    // can never cut the animation short and make it "snap"/compact early.
    growFrameRef.current = requestAnimationFrame(() => {
      growFrameRef.current = null;
      const liveGhost = ghostRef.current?.getEl();
      if (!liveGhost) return;
      liveGhost.style.transition = "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 150ms ease-out";
      liveGhost.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, 6px) scale(1)`;
      const onSettled = () => {
        liveGhost.style.transition = "none";
        liveGhost.style.transformOrigin = "center";
        liveGhost.removeEventListener("transitionend", onSettled);
        settleCleanupRef.current = null;
      };
      liveGhost.addEventListener("transitionend", onSettled, { once: true });
      settleCleanupRef.current = () => liveGhost.removeEventListener("transitionend", onSettled);
    });
    if (typeof document !== "undefined") {
      document.addEventListener("dragover", dragOverListenerRef.current, true);
    }
  };

  const end: DragGhostController["end"] = () => {
    clearPendingGrow();
    if (typeof document !== "undefined") {
      document.removeEventListener("dragover", dragOverListenerRef.current, true);
    }
    const handle = ghostRef.current;
    const ghost = handle?.getEl();
    if (ghost) {
      ghost.style.transition = "opacity 150ms ease-out";
      ghost.style.opacity = "0";
    }
    handle?.setContent(null);
  };

  return { ghostRef, transparentImageRef, spawn, end };
}

// Renders the two portal-mounted pieces a drag ghost needs: the 1x1
// transparent element handed to setDragImage() (so the browser's own drag
// image never shows), and the floating swinging pill itself. Mount this once
// per useDragGhost() instance, anywhere in the tree.
export function DragGhostLayer({ controller }: { controller: DragGhostController }) {
  const { ghostRef, transparentImageRef } = controller;
  if (typeof document === "undefined") return null;
  return (
    <>
      {createPortal(
        <div
          ref={transparentImageRef}
          aria-hidden="true"
          style={{ position: "fixed", top: 0, left: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />,
        document.body,
      )}
      <DragGhostPill ref={ghostRef} />
    </>
  );
}
