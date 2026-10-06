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
  // stays put. Adding this to a fixed popup's own position (see --keyboard-offset-top-px in
  // globals.css) re-anchors it to the visual viewport instead, so the whole popup — not just the
  // field — tracks the same nudge. (A fixed element sits this much HIGHER on screen than where it was
  // laid out, so it has to move down by the same amount to land back in view.)
  offsetTopPx: number;
};

// How much shorter than the layout viewport the visible area has to be, at normal zoom, to count as the
// on-screen keyboard being up — well clear of rounding/toolbar wobble, well under the smallest keyboard.
const KEYBOARD_OPEN_MIN_PX = 80;
// Set on <html> while the keyboard is up; app/globals.css caps every .glass-modal-panel to the visible
// area (--visual-viewport-height-px) only then, so nothing changes anywhere else (e.g. on desktop).
const KEYBOARD_OPEN_ATTR = "data-keyboard-open";
// Breathing room left between a field revealed by revealFocusedFieldInPanel and its scroll area's edge.
const REVEAL_MARGIN_PX = 12;

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

// Called right after a pop-up panel has been capped to the space above the keyboard. The cap can turn
// part of the panel into a scroll area, and the browser only scrolled the focused field into view at the
// moment it was focused (before the cap) — so bring it back into the visible part of whichever scroll
// area(s) inside the panel now hold it.
function revealFocusedFieldInPanel(): void {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || !field.closest(".glass-modal-panel")) return;
  for (let node = field.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      const box = node.getBoundingClientRect();
      const rect = field.getBoundingClientRect();
      if (rect.bottom > box.bottom) node.scrollTop += rect.bottom - box.bottom + REVEAL_MARGIN_PX;
      else if (rect.top < box.top) node.scrollTop -= box.top - rect.top + REVEAL_MARGIN_PX;
    }
    if (node.classList.contains("glass-modal-panel")) return;
  }
}

type PublishedViewport = KeyboardInset & {
  keyboardOpen: boolean;
  // The visible height while the keyboard is up; 0 otherwise (only read then — and not tracking it the
  // rest of the time keeps the browser toolbar sliding in/out from restyling the page on every scroll).
  visibleHeightPx: number;
};

// Publishes the keyboard inset as the CSS variables every .glass-modal-panel / .glass-modal-backdrop
// reads (--keyboard-inset-px / --keyboard-offset-top-px, plus --visual-viewport-height-px and the
// data-keyboard-open attribute while the keyboard is up, all on <html> — see app/globals.css). Written
// straight from the viewport listener — at most once a frame, and only when a value actually changed —
// instead of going through React state, which re-rendered the whole calling component (the app shell)
// on every viewport resize/scroll event while the keyboard or the browser toolbar moved.
export function usePublishKeyboardInsetVars(): void {
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    let last: PublishedViewport | null = null;
    let frame: number | null = null;
    const publish = () => {
      frame = null;
      // Pinch-zoom also shrinks the visual viewport, but at a scale above 1 — that isn't the keyboard.
      const keyboardOpen = vv.scale <= 1.01 && window.innerHeight - vv.height > KEYBOARD_OPEN_MIN_PX;
      const next: PublishedViewport = {
        ...readKeyboardInset(vv),
        keyboardOpen,
        visibleHeightPx: keyboardOpen ? Math.round(vv.height) : 0,
      };
      if (
        last &&
        last.insetPx === next.insetPx &&
        last.offsetTopPx === next.offsetTopPx &&
        last.keyboardOpen === next.keyboardOpen &&
        last.visibleHeightPx === next.visibleHeightPx
      ) {
        return;
      }
      const panelCapChanged = next.keyboardOpen && (!last?.keyboardOpen || last.visibleHeightPx !== next.visibleHeightPx);
      last = next;
      root.style.setProperty("--keyboard-inset-px", `${next.insetPx}px`);
      root.style.setProperty("--keyboard-offset-top-px", `${next.offsetTopPx}px`);
      if (next.keyboardOpen) {
        root.style.setProperty("--visual-viewport-height-px", `${next.visibleHeightPx}px`);
        root.setAttribute(KEYBOARD_OPEN_ATTR, "true");
      } else {
        root.removeAttribute(KEYBOARD_OPEN_ATTR);
      }
      if (panelCapChanged) revealFocusedFieldInPanel();
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
      root.removeAttribute(KEYBOARD_OPEN_ATTR);
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
