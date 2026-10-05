"use client";

import { useEffect, useState } from "react";

export type KeyboardInset = {
  // How much of the bottom of the screen the on-screen keyboard is currently covering, in px (0
  // when it's closed). Used to shift a fixed/centered popup upward while a field inside it is
  // being edited, so the keyboard opening doesn't just cover the field the user tapped — the
  // popup itself moves to stay in view, the way a native app's own bottom sheet would.
  insetPx: number;
  // How far the visual viewport's own top-left origin has scrolled down from the layout
  // viewport's origin, in px (0 when the keyboard is closed, or on a browser that never does
  // this). On iOS Safari specifically, focusing a field also nudges the page's own scroll
  // position to bring that field into view — but a `position: fixed` element is anchored to the
  // LAYOUT viewport, which that nudge doesn't move, only the VISUAL one does. The two drifting
  // apart is what makes a fixed popup visually detach from the very field the keyboard just
  // opened for: the browser's own scroll succeeds at revealing the field, but the popup around it
  // stays put. Subtracting this from a fixed popup's own position (see --keyboard-offset-top-px
  // in globals.css) re-anchors it to the visual viewport instead, so the whole popup — not just
  // the field — tracks the same nudge.
  offsetTopPx: number;
};

// window.visualViewport is the right tool for both of these: when the keyboard opens, the LAYOUT
// viewport (window.innerHeight) stays the same, but the VISUAL viewport (what's actually visible
// above the keyboard) shrinks and its origin can shift down — visualViewport reports both. Falls
// back to reporting 0/0 (no adjustment) on browsers without visualViewport support, which just
// means a popup stays put exactly like it did before this existed.
function readKeyboardInset(vv: VisualViewport): KeyboardInset {
  return {
    insetPx: Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)),
    offsetTopPx: Math.max(0, Math.round(vv.offsetTop)),
  };
}

// Publishes the keyboard inset as the CSS variables every .glass-modal-panel reads
// (--keyboard-inset-px / --keyboard-offset-top-px on <html>, see app/globals.css). Written straight
// from the viewport listener — at most once a frame, and only when a value actually changed — instead
// of going through React state, which re-rendered the whole calling component (the app shell) on every
// viewport resize/scroll event while the keyboard or the browser toolbar moved.
export function usePublishKeyboardInsetVars(): void {
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    let last: KeyboardInset | null = null;
    let frame: number | null = null;
    const publish = () => {
      frame = null;
      const next = readKeyboardInset(vv);
      if (last && last.insetPx === next.insetPx && last.offsetTopPx === next.offsetTopPx) return;
      last = next;
      root.style.setProperty("--keyboard-inset-px", `${next.insetPx}px`);
      root.style.setProperty("--keyboard-offset-top-px", `${next.offsetTopPx}px`);
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(publish);
    };
    publish();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);
}

export function useKeyboardInsetPx(): KeyboardInset {
  const [inset, setInset] = useState<KeyboardInset>({ insetPx: 0, offsetTopPx: 0 });

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => {
      const next = readKeyboardInset(vv);
      // Same numbers → same state object, so a viewport event that changes nothing (iOS fires plenty
      // while scrolling or as the toolbar slides) doesn't re-render the caller.
      setInset((prev) => (prev.insetPx === next.insetPx && prev.offsetTopPx === next.offsetTopPx ? prev : next));
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
