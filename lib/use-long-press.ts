"use client";

import { useRef, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from "react";

const LONG_PRESS_DELAY_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD_PX = 10;

type LongPressOrigin = { left: number; top: number; width: number; height: number };

// A press-and-hold gesture for mobile list rows whose desktop equivalent is a hover-revealed
// action button — touch devices have no hover, so instead of trying to fake one, holding the row
// itself triggers the action directly (e.g. Quote/Specs' own Version History rows, where desktop
// reveals a delete icon on hover and mobile instead long-presses the row to open the same delete
// confirmation). `origin` matches captureGlassModalOrigin(e)'s own shape, captured from the row's
// own on-screen box at the moment the press STARTED (not when the timer fires, in case the row
// has since scrolled) so a caller can grow a glass modal out of it exactly like a click would.
//
// One hook call per LIST (not per row) — `makeHandlers` is a plain factory, not a hook itself, so
// calling it fresh for each row inside a .map() is safe; every row's handlers close over the SAME
// shared timer/start refs below, which is fine since only one touch sequence is ever active at a
// time per user.
export function useLongPress() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const makeHandlers = (onLongPress: (origin: LongPressOrigin, target: HTMLElement) => void) => ({
    onTouchStart: (e: ReactTouchEvent<HTMLElement>) => {
      const touch = e.touches[0];
      if (!touch) return;
      const el = e.currentTarget;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      firedRef.current = false;
      clearTimer();
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        const rect = el.getBoundingClientRect();
        onLongPress({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }, el);
      }, LONG_PRESS_DELAY_MS);
    },
    onTouchMove: (e: ReactTouchEvent<HTMLElement>) => {
      const touch = e.touches[0];
      const start = startRef.current;
      if (!touch || !start) return;
      if (
        Math.abs(touch.clientX - start.x) > LONG_PRESS_MOVE_THRESHOLD_PX ||
        Math.abs(touch.clientY - start.y) > LONG_PRESS_MOVE_THRESHOLD_PX
      ) {
        clearTimer();
      }
    },
    // Suppresses the row's own tap action (e.g. opening the version) from ALSO firing right after
    // a successful long-press — mobile browsers synthesize a click from the same touch sequence
    // unless its touchend is prevented.
    onTouchEnd: (e: ReactTouchEvent<HTMLElement>) => {
      if (firedRef.current) e.preventDefault();
      clearTimer();
    },
    onTouchCancel: () => clearTimer(),
    // Belt-and-braces alongside onTouchEnd's preventDefault — runs in the capture phase so it can
    // swallow the click before the row's own onClick sees it, in case some browser still
    // synthesizes one.
    onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
      if (firedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        firedRef.current = false;
      }
    },
  });

  return { makeHandlers };
}
