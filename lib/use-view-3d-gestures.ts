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
// How far a press moves before it's a drag, not a tap (px).
const TAP_SLOP_PX = 4;

// The cursor while it's being turned: a small globe with two orbits round it — a flat one and an upright one, each
// passing behind it (a gap there) and ending in a small, light arrowhead the way it turns. Thin dark grey lines (1.2px;
// 2.4 at 2x) on a white edge only just wider (clean at cursor size, and it shows on dark too); 28px, its hotspot the
// middle. Given at 1x and 2x
// (image-set — sharp on a high-DPI screen) where the browser takes that, else at 1x; "move" where it takes neither.
// (The open and closed hands are the browser's own.)
const ORBIT_LINES =
  "M18 10.25A12 4 0 1 1 10 10.25M8.3 11.9L10 10.25L7.9 9.1" +
  "M17.75 18A4 12 0 1 1 17.75 10M16.1 8.3L17.75 10L18.9 7.9";
const orbitCursorSvg = (px: number) =>
  `<svg xmlns='http://www.w3.org/2000/svg' width='${px}' height='${px}' viewBox='0 0 28 28' fill='none' stroke-linecap='round' stroke-linejoin='round'>` +
  `<g stroke='white' stroke-width='2'><circle cx='14' cy='14' r='3.5'/><path d='${ORBIT_LINES}'/></g>` +
  `<g stroke='%23334155' stroke-width='1.2'><circle cx='14' cy='14' r='3.5'/><path d='${ORBIT_LINES}'/></g></svg>`;
const orbitCursorUrl = (px: number) => `url("data:image/svg+xml,${orbitCursorSvg(px).replace(/</g, "%3C").replace(/>/g, "%3E")}")`;
const ORBIT_CURSOR_PLAIN = `${orbitCursorUrl(28)} 14 14, move`;
let orbitCursor: string | null = null;
// (The first of them the browser takes — worked out once, in the browser.)
export function orbitCursorValue(): string {
  if (orbitCursor) return orbitCursor;
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return ORBIT_CURSOR_PLAIN;
  const set = `${orbitCursorUrl(28)} 1x, ${orbitCursorUrl(56)} 2x`;
  orbitCursor = [`image-set(${set}) 14 14, move`, `-webkit-image-set(${set}) 14 14, move`, ORBIT_CURSOR_PLAIN].find((value) => CSS.supports("cursor", value)) ?? ORBIT_CURSOR_PLAIN;
  return orbitCursor;
}

// A finger, not a mouse: the hint says so.
const subscribeCoarsePointer = (onChange: () => void) => {
  const query = window.matchMedia("(pointer: coarse)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const readCoarsePointer = () => window.matchMedia("(pointer: coarse)").matches;

// A turn already under way when the view's put up — a right-drag on the 2D drawing that's carried on into 3D: the
// pointer, and where it is (client px).
export type View3dTurnStart = { pointerId: number; x: number; y: number };

// The gestures on a 3D view. A mouse: the left button dragged moves it; the right or middle, dragged, turns it (`onTurn`
// — how far it's been dragged since it was last heard, px; nothing to turn: it moves it too); the wheel zooms it (only while
// the pointer's over it — the page scrolls as ever elsewhere). A touch screen: one finger turns it (moves it, if
// there's nothing to turn), two pinch it — zoomed and moved with them. No browser menu over it.
// `onTap`: a left click or a tap that didn't move (not the end of a drag), where (client px). `startTurn`: a turn
// carried on from elsewhere as it's put up (see View3dTurnStart).
// `attachTo`: the element over the view, given as its ref (the wheel's heard on it, its pointer held by a drag);
// `handlers`: its pointer events; `cursor`: the hand to show over it — open (it can be moved), closed (it's being moved),
// or the orbit one (it's being turned).
export function useView3dGestures({
  onTurn,
  onTap,
  startTurn = null,
}: { onTurn?: (dx: number, dy: number) => void; onTap?: (clientX: number, clientY: number) => void; startTurn?: View3dTurnStart | null } = {}) {
  const [zoom, setZoom] = useState<View3dZoom>(NO_ZOOM);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const coarse = useSyncExternalStore(subscribeCoarsePointer, readCoarsePointer, () => false);
  const canTurn = Boolean(onTurn);
  type Drag = { pointerId: number; mode: "move" | "turn"; x: number; y: number; zx: number; zy: number; lastX: number; lastY: number; moved: boolean; tap: boolean };
  const dragRef = useRef<Drag | null>(
    startTurn && canTurn
      ? { pointerId: startTurn.pointerId, mode: "turn", x: startTurn.x, y: startTurn.y, zx: 0, zy: 0, lastX: startTurn.x, lastY: startTurn.y, moved: true, tap: false }
      : null,
  );
  // What's being done now (the cursor shows it): moving it, turning it, or nothing.
  const [dragging, setDragging] = useState<"move" | "turn" | null>(startTurn && canTurn ? "turn" : null);
  const touchesRef = useRef(new Map<number, [number, number]>());
  const pinchRef = useRef<{ dist: number; mid: [number, number]; zoom: View3dZoom } | null>(null);
  const pinchedRef = useRef(false);

  // (A turn carried on into it: the pointer's its own from here.)
  useEffect(() => {
    if (!host || !startTurn) return;
    try {
      host.setPointerCapture(startTurn.pointerId);
    } catch {
      // (Already let go.)
    }
  }, [host, startTurn]);

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

  const startDrag = (event: ReactPointerEvent<Element>, mode: "move" | "turn", tap: boolean) => {
    const { clientX: x, clientY: y } = event;
    const real = mode === "turn" && canTurn ? "turn" : "move";
    dragRef.current = { pointerId: event.pointerId, mode: real, x, y, zx: zoom.x, zy: zoom.y, lastX: x, lastY: y, moved: false, tap };
    // (Turning shows at once; moving once it moves.)
    if (real === "turn" && event.pointerType === "mouse") setDragging("turn");
  };
  const onPointerDown = (event: ReactPointerEvent<Element>) => {
    // (Its own buttons — Reset view — are pressed, not dragged.)
    if (event.target instanceof Element && event.target.closest("button")) return;
    if (event.pointerType === "mouse") {
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
      // (The middle button: no autoscroll.)
      if (event.button === 1) event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      startDrag(event, event.button === 0 ? "move" : "turn", event.button === 0);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const touches = touchesRef.current;
    if (!touches.size) pinchedRef.current = false;
    touches.set(event.pointerId, local(event.clientX, event.clientY));
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinchRef.current = { dist: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], zoom };
      pinchedRef.current = true;
      dragRef.current = null;
      setDragging(null);
    } else if (touches.size === 1) {
      startDrag(event, "turn", true);
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
    // (A mouse whose buttons are all up — a turn handed over that's ended — lets it go.)
    if (event.pointerType === "mouse" && event.buttons === 0) {
      dragRef.current = null;
      setDragging(null);
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < TAP_SLOP_PX) return;
      drag.moved = true;
      setDragging(drag.mode);
    }
    if (drag.mode === "turn") {
      onTurn?.(event.clientX - drag.lastX, event.clientY - drag.lastY);
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
    } else setZoom((prev) => ({ ...prev, x: drag.zx + dx, y: drag.zy + dy }));
  };
  const onPointerUp = (event: ReactPointerEvent<Element>) => {
    touchesRef.current.delete(event.pointerId);
    if (touchesRef.current.size < 2) pinchRef.current = null;
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(null);
      // (A press that didn't move — not a drag, nor a pinch's: a tap.)
      if (event.type === "pointerup" && drag.tap && !drag.moved && !pinchedRef.current) onTap?.(event.clientX, event.clientY);
    }
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
    zoom,
    zoomed: zoom.z !== 1 || zoom.x !== 0 || zoom.y !== 0,
    resetZoom: () => setZoom(NO_ZOOM),
    cursor: dragging === "turn" ? orbitCursorValue() : dragging === "move" ? "grabbing" : "grab",
    coarse,
  };
}
