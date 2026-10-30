"use client";

import { useEffect } from "react";

// Swipe down to close a pop-up, on a touch screen — every pop-up in the app (.glass-modal-panel) with a Close (X) button.
// Only from its top: with what's in it scrolled down (a long event), a swipe down scrolls back up as it always has; once
// it's at the top, the pop-up follows the finger down, the backdrop fading, and let go far or fast enough it's closed —
// its X pressed, so whatever that does (asking "Discard changes?" first, say) still happens; otherwise it springs back.
// Not from something with its own up-and-down drag: a scroller that isn't at its top (a date or time wheel), a slider, a
// text editor, a drawing — or anything marked data-swipe-close="off" (a whole pop-up, or a part of one).

const ENGAGE_PX = 10;
const CLOSE_PX = 110;
const CLOSE_PX_PER_MS = 0.6;
const SETTLE_MS = 220;
const EXCLUDED = '[data-swipe-close="off"], input[type="range"], canvas, [contenteditable="true"], .ck-editor';

function closeButtonOf(panel: HTMLElement): HTMLButtonElement | null {
  return panel.querySelector<HTMLButtonElement>('button[aria-label="Close" i]:not(:disabled)');
}

// Whether a swipe down from `target` would scroll something back up first: anything scrolled down between it and the
// pop-up (the pop-up itself included).
function scrolledDown(target: Element, panel: HTMLElement): boolean {
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (el instanceof HTMLElement && el.scrollTop > 0 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) return true;
    if (el === panel) break;
  }
  return false;
}

type Drag = {
  panel: HTMLElement;
  backdrop: HTMLElement | null;
  startX: number;
  startY: number;
  lastY: number;
  lastTime: number;
  speed: number;
  engaged: boolean;
};

export function ModalSwipeToClose() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    let drag: Drag | null = null;
    // (The panel's `translate` — not its transform, which keeps it above the keyboard — so the two add up.)
    const place = (current: Drag, offset: number, settleMs = 0) => {
      const easing = `${settleMs}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
      current.panel.style.transition = settleMs ? `translate ${easing}` : "none";
      current.panel.style.translate = offset ? `0 ${offset}px` : "";
      if (current.backdrop) {
        current.backdrop.style.transition = settleMs ? `opacity ${easing}` : "none";
        current.backdrop.style.opacity = offset ? String(Math.max(0.25, 1 - offset / 500)) : "";
      }
    };
    const springBack = (current: Drag) => {
      place(current, 0, SETTLE_MS);
      window.setTimeout(() => {
        current.panel.style.transition = "";
        if (current.backdrop) current.backdrop.style.transition = "";
      }, SETTLE_MS);
    };
    const onStart = (event: TouchEvent) => {
      drag = null;
      if (event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      const panel = target?.closest<HTMLElement>(".glass-modal-panel");
      if (!target || !panel || !closeButtonOf(panel) || target.closest(EXCLUDED) || scrolledDown(target, panel)) return;
      const touch = event.touches[0];
      drag = {
        panel,
        backdrop: panel.parentElement?.querySelector<HTMLElement>(":scope > .glass-modal-backdrop") ?? null,
        startX: touch.clientX,
        startY: touch.clientY,
        lastY: touch.clientY,
        lastTime: event.timeStamp,
        speed: 0,
        engaged: false,
      };
    };
    const onMove = (event: TouchEvent) => {
      const current = drag;
      if (!current) return;
      const touch = event.touches[0];
      const dx = touch.clientX - current.startX;
      const dy = touch.clientY - current.startY;
      if (!current.engaged) {
        // Sideways, or up (into what's in it): not a swipe to close — left alone.
        if ((Math.abs(dx) > ENGAGE_PX && Math.abs(dx) > Math.abs(dy)) || dy < -ENGAGE_PX) {
          drag = null;
          return;
        }
        if (dy < ENGAGE_PX) return;
        current.engaged = true;
      }
      event.preventDefault();
      const elapsed = event.timeStamp - current.lastTime;
      if (elapsed > 0) current.speed = (touch.clientY - current.lastY) / elapsed;
      current.lastY = touch.clientY;
      current.lastTime = event.timeStamp;
      place(current, Math.max(0, dy - ENGAGE_PX));
    };
    const onEnd = () => {
      const current = drag;
      drag = null;
      if (!current?.engaged) return;
      const offset = Math.max(0, current.lastY - current.startY - ENGAGE_PX);
      const close = closeButtonOf(current.panel);
      if (!close || (offset < CLOSE_PX && current.speed < CLOSE_PX_PER_MS)) {
        springBack(current);
        return;
      }
      // Off the bottom, then closed. Still there a moment later (it asked first, or wouldn't close): back where it was.
      place(current, window.innerHeight, SETTLE_MS);
      window.setTimeout(() => {
        close.click();
        window.setTimeout(() => {
          if (current.panel.isConnected) springBack(current);
        }, 700);
      }, SETTLE_MS);
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);
  return null;
}
