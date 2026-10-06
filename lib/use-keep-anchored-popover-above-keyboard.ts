"use client";

import { useLayoutEffect, type RefObject } from "react";

// Room left between the popover and the edge of what's visible.
const EDGE_MARGIN_PX = 8;
// Same test lib/use-keyboard-inset.ts uses for "the on-screen keyboard is up": the visible area is at
// least this much shorter than the layout viewport, at normal zoom (pinch-zoom shrinks it too).
const KEYBOARD_OPEN_MIN_PX = 80;

export type AnchoredPopoverPlacement = {
  // Where the popover normally sits: its CSS `top`, in the layout-viewport px its position: fixed
  // (or fixed full-screen wrapper) is laid out in — e.g. just below the button that opened it.
  preferredTop: number;
  // The top edge of that button, and the gap to leave above it if the popover has to move up there.
  anchorTop: number;
  gap: number;
};

// Keeps a popover that's pinned to the button that opened it inside what's actually visible while the
// on-screen keyboard is up. Opened from low on the screen (or opened with the keyboard already up), it
// would otherwise sit underneath the keyboard. It moves above its button when it fits there; failing
// that, it's kept as close to its spot as the visible area allows, shrinking to fit (its own content
// scrolls) if it's taller than that area.
//
// While the keyboard is down — and so always on desktop — it stays exactly where its caller put it.
// Pass null while the popover is closed. Writes the element's own top/max-height directly instead of
// going through React state, so the page around it isn't re-rendered while the keyboard slides.
export function useKeepAnchoredPopoverAboveKeyboard(
  panelRef: RefObject<HTMLElement | null>,
  placement: AnchoredPopoverPlacement | null,
): void {
  const preferredTop = placement ? placement.preferredTop : null;
  const anchorTop = placement ? placement.anchorTop : 0;
  const gap = placement ? placement.gap : 0;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    if (!panel || preferredTop === null || !vv) return;
    const place = () => {
      panel.style.top = `${preferredTop}px`;
      panel.style.maxHeight = "";
      if (vv.scale > 1.01 || window.innerHeight - vv.height <= KEYBOARD_OPEN_MIN_PX) return;
      // The visible area in the same layout-viewport px as `top` (iOS can scroll it down from the top).
      const visibleTop = vv.offsetTop + EDGE_MARGIN_PX;
      const visibleBottom = vv.offsetTop + vv.height - EDGE_MARGIN_PX;
      // offsetHeight ignores transforms, so a pop-in scale animation mid-way doesn't skew this.
      const height = panel.offsetHeight;
      if (preferredTop >= visibleTop && preferredTop + height <= visibleBottom) return;
      const aboveTop = anchorTop - gap - height;
      if (aboveTop >= visibleTop && aboveTop + height <= visibleBottom) {
        panel.style.top = `${Math.round(aboveTop)}px`;
        return;
      }
      const fitHeight = Math.max(0, Math.min(height, visibleBottom - visibleTop));
      if (fitHeight < height) panel.style.maxHeight = `${Math.floor(fitHeight)}px`;
      const top = Math.min(Math.max(preferredTop, visibleTop), visibleBottom - fitHeight);
      panel.style.top = `${Math.round(top)}px`;
    };
    place();
    vv.addEventListener("resize", place);
    vv.addEventListener("scroll", place);
    // Its content can change height while open (e.g. a picker moving on to its next step).
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(panel);
    return () => {
      vv.removeEventListener("resize", place);
      vv.removeEventListener("scroll", place);
      observer?.disconnect();
    };
  }, [panelRef, preferredTop, anchorTop, gap]);
}
