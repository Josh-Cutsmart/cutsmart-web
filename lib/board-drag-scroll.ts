import { swallowNextClick } from "@/lib/swallow-dismiss-click";

// Click-and-drag scrolling for a horizontally-scrolling kanban board (used by the Dashboard board/
// sub-board — same `[data-board-column]` / `.board-column-scroll` markup convention as
// lib/board-arrow-key-scroll.ts and lib/board-sticky-scroll.ts). Pressing anywhere on the board
// that isn't a card or a control — the background between/around the columns, a column's header,
// the empty space in its card list — and dragging slides the board sideways, as if grabbing the
// board itself. When the press lands inside a column's card list that is currently scrollable, the
// vertical part of the same drag scrolls that list too.
//
// WHAT CAN START A DRAG: only a primary-button mouse press at the `lg` breakpoint and up, while the
// board actually overflows sideways. Touch and pen are ignored entirely, so mobile keeps the
// browser's own native swipe-scrolling untouched. Never a press on a card (cards keep their own
// drag-and-drop to change status) or on anything interactive (buttons — including a collapsed
// column, which is one big button — links, inputs, role="button" elements, …): those presses are
// left completely alone.
//
// PRESS vs DRAG: nothing happens until the pointer has moved DRAG_THRESHOLD_PX from where it was
// pressed, so a plain click on the board behaves exactly as before. Past that it's a drag: the
// pointer is captured (the drag keeps tracking outside the board, even outside the window), text
// selection is blocked, and the click the browser fires on release is swallowed — letting go after
// a drag must never act on whatever happens to be under the pointer.
//
// CURSOR: the board shows a grab cursor whenever it can be dragged (cards and controls keep their
// own pointer cursor, since they set one of their own), and everything shows grabbing for the length
// of a drag. The grab cursor is also what app-shell's app-wide text-selection guard keys off to treat
// a press here as the start of a drag rather than of a text selection.
//
// MOMENTUM: letting go mid-swipe lets the board glide on and ease to a stop, like a trackpad fling
// (skipped under prefers-reduced-motion). Any new press, or a wheel scroll over the board, stops it.
//
// SCROLL SNAP: snapping fights every scrollLeft write mid-drag, so if the board has scroll-snap
// active it's switched off for the drag (and any glide after it) and restored afterwards. The
// Dashboard board only snaps below `sm`, so at desktop widths this is normally a no-op.

const DRAG_THRESHOLD_PX = 5;
// Desktop: `lg` and up with a mouse/trackpad available — the same desktop-only split as the board's
// replacement horizontal scrollbar.
const DESKTOP_QUERY = "(min-width: 1024px) and (any-pointer: fine)";
// A press that starts on (or inside) any of these is never a board drag.
const NO_DRAG_SELECTOR = [
  '[draggable="true"]',
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="tab"]',
  "[data-no-drag-scroll]",
].join(",");
const CARD_LIST_SELECTOR = ".board-column-scroll";
// Release speed is measured over the last MOMENTUM_SAMPLE_MS of the drag. If the pointer was held
// still for MOMENTUM_STALE_MS before letting go, that's a deliberate placement, not a fling.
const MOMENTUM_SAMPLE_MS = 80;
const MOMENTUM_STALE_MS = 50;
// px per ms. Below MIN_FLING a release just stops where it is; MAX caps a wild flick.
const MOMENTUM_MIN_FLING = 0.3;
const MOMENTUM_MAX_SPEED = 4;
const MOMENTUM_STOP_SPEED = 0.02;
// Speed kept per 16ms frame — 0.95 carries a 1px/ms fling roughly 320px.
const MOMENTUM_FRICTION = 0.95;
// Everything shows the grabbing hand during a drag (cards and buttons included — they set their own
// cursor, hence !important), and nothing can be text-selected.
const DRAGGING_STYLE = "*{cursor:grabbing!important;-webkit-user-select:none!important;user-select:none!important}";

type Press = {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  // The card list the press started in, when it can currently scroll — see onPointerDown.
  list: HTMLElement | null;
  dragging: boolean;
  samples: Array<{ t: number; x: number; y: number }>;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function attachBoardDragScroll(container: HTMLElement): () => void {
  const desktopQuery = window.matchMedia(DESKTOP_QUERY);
  const canDragNow = () => desktopQuery.matches && container.scrollWidth > container.clientWidth + 1;

  // --- Cursor -------------------------------------------------------------------------------
  // Only a board that can actually move gets the grab cursor. Whether it overflows changes with the
  // board's own size (window/sidebar resize) and its content's width (columns loading in, a column
  // collapsing/expanding, the sub-board swapping in for the main one) — the board's direct children
  // are its column rows, so watching those plus the board itself catches all of it. Refreshed on the
  // next frame rather than inside the observer callbacks, so it never forces an extra layout.
  let cursorRaf = 0;
  const refreshCursor = () => {
    cursorRaf = 0;
    container.style.cursor = canDragNow() ? "grab" : "";
  };
  const scheduleCursorRefresh = () => {
    if (!cursorRaf) cursorRaf = window.requestAnimationFrame(refreshCursor);
  };
  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleCursorRefresh) : null;
  const observeRows = () => {
    if (!resizeObserver) return;
    resizeObserver.disconnect();
    resizeObserver.observe(container);
    Array.from(container.children).forEach((child) => resizeObserver.observe(child));
  };
  const rowObserver = new MutationObserver(() => {
    observeRows();
    scheduleCursorRefresh();
  });
  rowObserver.observe(container, { childList: true });
  observeRows();
  desktopQuery.addEventListener("change", scheduleCursorRefresh);
  scheduleCursorRefresh();

  // --- Scroll snap --------------------------------------------------------------------------
  let snapOverride: { previousInline: string } | null = null;
  const suspendSnap = () => {
    if (snapOverride || getComputedStyle(container).scrollSnapType === "none") return;
    snapOverride = { previousInline: container.style.scrollSnapType };
    container.style.scrollSnapType = "none";
  };
  const restoreSnap = () => {
    if (!snapOverride) return;
    container.style.scrollSnapType = snapOverride.previousInline;
    snapOverride = null;
  };

  // --- Grabbing cursor + no text selection, for the length of a drag only ----------------------
  let draggingStyleEl: HTMLStyleElement | null = null;
  const setDraggingStyle = (on: boolean) => {
    if (on && !draggingStyleEl) {
      draggingStyleEl = document.createElement("style");
      draggingStyleEl.textContent = DRAGGING_STYLE;
      document.head.appendChild(draggingStyleEl);
    } else if (!on && draggingStyleEl) {
      draggingStyleEl.remove();
      draggingStyleEl = null;
    }
  };

  // --- Momentum -----------------------------------------------------------------------------
  let momentumRaf = 0;
  const stopMomentum = () => {
    if (!momentumRaf) return;
    window.cancelAnimationFrame(momentumRaf);
    momentumRaf = 0;
    restoreSnap();
  };
  // vx/vy are the pointer's own speed (px/ms); the content moves with the pointer, so the scroll
  // position moves the opposite way. Positions are tracked as floats here rather than re-read from
  // scrollLeft/scrollTop each frame — those round to whole (device) pixels, which would stall the
  // slow tail end of the glide.
  const glide = (vx: number, vy: number, list: HTMLElement | null) => {
    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const maxTop = list ? Math.max(0, list.scrollHeight - list.clientHeight) : 0;
    let left = container.scrollLeft;
    let top = list?.scrollTop ?? 0;
    let last = performance.now();
    const step = (now: number) => {
      // Capped so a frame delayed by a busy main thread doesn't jump the board.
      const dt = Math.min(32, now - last);
      last = now;
      const decay = Math.pow(MOMENTUM_FRICTION, dt / 16);
      vx *= decay;
      vy *= decay;
      left = clamp(left - vx * dt, 0, maxLeft);
      if (left === 0 || left === maxLeft) vx = 0;
      container.scrollLeft = left;
      if (list) {
        top = clamp(top - vy * dt, 0, maxTop);
        if (top === 0 || top === maxTop) vy = 0;
        list.scrollTop = top;
      }
      if (Math.abs(vx) < MOMENTUM_STOP_SPEED && Math.abs(vy) < MOMENTUM_STOP_SPEED) {
        momentumRaf = 0;
        restoreSnap();
        return;
      }
      momentumRaf = window.requestAnimationFrame(step);
    };
    momentumRaf = window.requestAnimationFrame(step);
  };
  const releaseVelocity = (ended: Press, releaseTime: number): { x: number; y: number } | null => {
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    const recent = ended.samples.filter((s) => releaseTime - s.t <= MOMENTUM_SAMPLE_MS);
    if (recent.length < 2) return null;
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (releaseTime - last.t > MOMENTUM_STALE_MS) return null;
    const dt = last.t - first.t;
    if (dt <= 0) return null;
    const x = clamp((last.x - first.x) / dt, -MOMENTUM_MAX_SPEED, MOMENTUM_MAX_SPEED);
    const y = ended.list ? clamp((last.y - first.y) / dt, -MOMENTUM_MAX_SPEED, MOMENTUM_MAX_SPEED) : 0;
    if (Math.abs(x) < MOMENTUM_MIN_FLING && Math.abs(y) < MOMENTUM_MIN_FLING) return null;
    return { x, y };
  };

  // --- The press/drag itself ----------------------------------------------------------------
  let press: Press | null = null;

  const beginDrag = (current: Press) => {
    current.dragging = true;
    try {
      container.setPointerCapture(current.pointerId);
    } catch {
      // The pointer is already gone (released between events) — the next move/up ends the press.
    }
    suspendSnap();
    setDraggingStyle(true);
  };

  // releaseEvent is null when the press ends some other way (cancelled, the window losing focus, the
  // board unmounting) — there's no click to swallow and no fling to carry on then.
  const endPress = (releaseEvent: PointerEvent | null) => {
    const ended = press;
    press = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("blur", onPointerCancel);
    if (!ended?.dragging) return;
    setDraggingStyle(false);
    try {
      if (container.hasPointerCapture(ended.pointerId)) container.releasePointerCapture(ended.pointerId);
    } catch {
      // Already released.
    }
    if (!releaseEvent) {
      restoreSnap();
      return;
    }
    swallowNextClick();
    const velocity = releaseVelocity(ended, releaseEvent.timeStamp);
    if (velocity) glide(velocity.x, velocity.y, ended.list);
    else restoreSnap();
  };

  const onPointerMove = (e: PointerEvent) => {
    const current = press;
    if (!current || e.pointerId !== current.pointerId) return;
    // The button came up somewhere this never heard about (e.g. released over another window).
    if ((e.buttons & 1) === 0) {
      endPress(null);
      return;
    }
    const dx = e.clientX - current.startX;
    const dy = e.clientY - current.startY;
    if (!current.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      beginDrag(current);
    }
    // Measured from the press point (not the threshold crossing), so the spot that was grabbed stays
    // under the pointer for the whole drag.
    container.scrollLeft = current.startLeft - dx;
    if (current.list) current.list.scrollTop = current.startTop - dy;
    current.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    while (current.samples.length > 2 && e.timeStamp - current.samples[0].t > MOMENTUM_SAMPLE_MS) current.samples.shift();
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.pointerId) return;
    endPress(e);
  };

  const onPointerCancel = () => endPress(null);

  const onPointerDown = (e: PointerEvent) => {
    if (press) endPress(null);
    if (e.defaultPrevented || e.pointerType !== "mouse" || !e.isPrimary || e.button !== 0) return;
    // Ctrl/Cmd+click mean something else (context menu on macOS, open-in-new-tab) — leave them be.
    if (e.ctrlKey || e.metaKey) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    // Only blockers inside the board count — never some ancestor of the board itself.
    const blocker = target.closest(NO_DRAG_SELECTOR);
    if (blocker && container.contains(blocker)) return;
    if (!canDragNow()) return;
    // Vertical dragging only applies to a card list that can scroll right now — while the board is
    // still scrolling up into its stuck position, lib/board-sticky-scroll.ts keeps every list at
    // overflow-y:hidden (still scrollable from script, so that has to be checked here explicitly).
    const listEl = target.closest<HTMLElement>(CARD_LIST_SELECTOR);
    const list =
      listEl && container.contains(listEl) && getComputedStyle(listEl).overflowY !== "hidden" && listEl.scrollHeight > listEl.clientHeight + 1
        ? listEl
        : null;
    press = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: container.scrollLeft,
      startTop: list?.scrollTop ?? 0,
      list,
      dragging: false,
      samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onPointerCancel);
  };

  // Capture lost mid-drag without a pointerup (e.g. the element was torn down) — end cleanly. After
  // a normal release press is already null here, so this is a no-op.
  const onLostPointerCapture = (e: PointerEvent) => {
    if (press?.dragging && e.pointerId === press.pointerId) endPress(null);
  };
  // No text selection can start from a board press — the browser would otherwise begin selecting
  // column names/labels as soon as the pointer moves.
  const onSelectStart = (e: Event) => {
    if (press) e.preventDefault();
  };
  // Same for a native drag of any already-selected text under the press. Cards never get here: a
  // press on a card is never tracked (see onPointerDown), so their own drag-and-drop is untouched.
  const onDragStart = (e: DragEvent) => {
    if (press) e.preventDefault();
  };

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("lostpointercapture", onLostPointerCapture);
  container.addEventListener("selectstart", onSelectStart);
  container.addEventListener("dragstart", onDragStart);
  // Any new press (anywhere — the board, its replacement scrollbar, …) or a wheel scroll over the
  // board catches a glide that's still running, the way touching a flung list stops it.
  document.addEventListener("pointerdown", stopMomentum, true);
  container.addEventListener("wheel", stopMomentum, { passive: true });
  return () => {
    endPress(null);
    stopMomentum();
    restoreSnap();
    if (cursorRaf) window.cancelAnimationFrame(cursorRaf);
    resizeObserver?.disconnect();
    rowObserver.disconnect();
    desktopQuery.removeEventListener("change", scheduleCursorRefresh);
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("lostpointercapture", onLostPointerCapture);
    container.removeEventListener("selectstart", onSelectStart);
    container.removeEventListener("dragstart", onDragStart);
    document.removeEventListener("pointerdown", stopMomentum, true);
    container.removeEventListener("wheel", stopMomentum);
    container.style.cursor = "";
  };
}
