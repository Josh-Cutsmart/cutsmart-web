"use client";

import { useEffect, useState } from "react";

// How much of the bottom of the screen the on-screen keyboard is currently covering, in px (0
// when it's closed). Used to shift a fixed/centered popup upward while a field inside it is being
// edited, so the keyboard opening doesn't just cover the field the user tapped — the popup itself
// moves to stay in view, the way a native app's own bottom sheet would.
//
// window.visualViewport is the right tool for this: when the keyboard opens, the LAYOUT viewport
// (window.innerHeight) stays the same, but the VISUAL viewport (what's actually visible above the
// keyboard) shrinks — the gap between them is the keyboard's own height. Falls back to reporting 0
// (no adjustment) on browsers without visualViewport support, which just means the popup stays put
// exactly like it did before this existed.
export function useKeyboardInsetPx(): number {
  const [insetPx, setInsetPx] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => {
      const inset = window.innerHeight - vv.height - vv.offsetTop;
      setInsetPx(Math.max(0, Math.round(inset)));
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return insetPx;
}
