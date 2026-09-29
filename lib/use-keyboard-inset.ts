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
export function useKeyboardInsetPx(): KeyboardInset {
  const [inset, setInset] = useState<KeyboardInset>({ insetPx: 0, offsetTopPx: 0 });

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => {
      const insetPx = window.innerHeight - vv.height - vv.offsetTop;
      setInset({
        insetPx: Math.max(0, Math.round(insetPx)),
        offsetTopPx: Math.max(0, Math.round(vv.offsetTop)),
      });
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
