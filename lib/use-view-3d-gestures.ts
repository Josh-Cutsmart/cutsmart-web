"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

// ---- Moving and zooming a 3D view: what's drawn is put through `transform` — zoomed by z about the view's top left,
// then moved by x, y (px). Zoomed about the pointer (the wheel) or the fingers (a pinch), a quarter to twelve times.
export type View3dZoom = { z: number; x: number; y: number };
const NO_ZOOM: View3dZoom = { z: 1, x: 0, y: 0 };
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 12;

// A finger, not a mouse: the hint says so.
const subscribeCoarsePointer = (onChange: () => void) => {
  const query = window.matchMedia("(pointer: coarse)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const readCoarsePointer = () => window.matchMedia("(pointer: coarse)").matches;

// The gestures on a 3D view. A mouse: the left button dragged moves it; the right or middle, dragged, turns it (`onTurn`
// — how far it's been dragged since it was last heard, px; nothing to turn: it moves it too); the wheel zooms it (only while
// the pointer's over it — the page scrolls as ever elsewhere). A touch screen: one finger turns it (moves it, if
// there's nothing to turn), two pinch it — zoomed and moved with them. No browser menu over it.
// `attachTo`: the element over the view, given as its ref (the wheel's heard on it); `handlers`: the view's own pointer events.
export function useView3dGestures({ onTurn }: { onTurn?: (dx: number, dy: number) => void } = {}) {
  const [zoom, setZoom] = useState<View3dZoom>(NO_ZOOM);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const coarse = useSyncExternalStore(subscribeCoarsePointer, readCoarsePointer, () => false);
  const dragRef = useRef<{ pointerId: number; mode: "move" | "turn"; x: number; y: number; zx: number; zy: number; lastX: number; lastY: number } | null>(null);
  const touchesRef = useRef(new Map<number, [number, number]>());
  const pinchRef = useRef<{ dist: number; mid: [number, number]; zoom: View3dZoom } | null>(null);
  const canTurn = Boolean(onTurn);

  const local = (clientX: number, clientY: number): [number, number] => {
    const box = host?.getBoundingClientRect();
    return box ? [clientX - box.left, clientY - box.top] : [clientX, clientY];
  };
  const zoomAt = (x: number, y: number, factor: number) =>
    setZoom((prev) => {
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.z * factor));
      const k = z / prev.z;
      return { z, x: x - (x - prev.x) * k, y: y - (y - prev.y) * k };
    });
  // (Heard as the browser's own — not passive — so the page doesn't scroll or zoom as well.)
  const onWheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const [x, y] = local(event.clientX, event.clientY);
    zoomAt(x, y, Math.exp(-event.deltaY * unit * (event.ctrlKey ? 0.01 : 0.002)));
  });
  useEffect(() => {
    if (!host) return;
    const handler = (event: WheelEvent) => onWheel(event);
    host.addEventListener("wheel", handler, { passive: false });
    return () => host.removeEventListener("wheel", handler);
  }, [host]);

  const startDrag = (event: ReactPointerEvent<Element>, mode: "move" | "turn") => {
    const { clientX: x, clientY: y } = event;
    dragRef.current = { pointerId: event.pointerId, mode: mode === "turn" && canTurn ? "turn" : "move", x, y, zx: zoom.x, zy: zoom.y, lastX: x, lastY: y };
  };
  const onPointerDown = (event: ReactPointerEvent<Element>) => {
    if (event.pointerType === "mouse") {
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
      // (The middle button: no autoscroll.)
      if (event.button === 1) event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      startDrag(event, event.button === 0 ? "move" : "turn");
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const touches = touchesRef.current;
    touches.set(event.pointerId, local(event.clientX, event.clientY));
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinchRef.current = { dist: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], zoom };
      dragRef.current = null;
    } else if (touches.size === 1) {
      startDrag(event, "turn");
    }
  };
  const onPointerMove = (event: ReactPointerEvent<Element>) => {
    const touches = touchesRef.current;
    if (touches.has(event.pointerId)) touches.set(event.pointerId, local(event.clientX, event.clientY));
    const pinch = pinchRef.current;
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinch.zoom.z * (Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.dist)));
      const k = z / pinch.zoom.z;
      setZoom({ z, x: mid[0] - (pinch.mid[0] - pinch.zoom.x) * k, y: mid[1] - (pinch.mid[1] - pinch.zoom.y) * k });
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.mode === "turn") {
      onTurn?.(event.clientX - drag.lastX, event.clientY - drag.lastY);
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
    } else setZoom((prev) => ({ ...prev, x: drag.zx + dx, y: drag.zy + dy }));
  };
  const onPointerUp = (event: ReactPointerEvent<Element>) => {
    touchesRef.current.delete(event.pointerId);
    if (touchesRef.current.size < 2) pinchRef.current = null;
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };
  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onMouseDown: (event: ReactMouseEvent<Element>) => {
      if (event.button === 1) event.preventDefault();
    },
    onAuxClick: (event: ReactMouseEvent<Element>) => event.preventDefault(),
    // (A right-drag turns it — and a right-click on it does nothing: no browser menu over it.)
    onContextMenu: (event: ReactMouseEvent<Element>) => event.preventDefault(),
  };
  return {
    attachTo: setHost,
    handlers,
    transform: `translate(${zoom.x} ${zoom.y}) scale(${zoom.z})`,
    zoomed: zoom.z !== 1 || zoom.x !== 0 || zoom.y !== 0,
    resetZoom: () => setZoom(NO_ZOOM),
    coarse,
  };
}
