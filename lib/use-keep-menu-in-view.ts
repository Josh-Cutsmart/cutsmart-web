"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";

// Room left between a menu and the edge of the screen.
const EDGE_MARGIN_PX = 8;

type ElementSource = RefObject<HTMLElement | null> | (() => HTMLElement | null);

const elementOf = (source: ElementSource): HTMLElement | null =>
  typeof source === "function" ? source() : source.current;

// For a dropdown menu that's position: fixed just below what opened it (its button, or the text box it suggests
// for): keeps it on screen. When there isn't room for it below, it opens above instead — whichever side has more
// room — and if neither side has room for all of it, it's kept to the room there is (its own list scrolls).
//
// Placed after every render while it's open, and again whenever the menu changes size (a list being filtered),
// the page scrolls or resizes, or the on-screen keyboard comes and goes. Writes the menu element's own top /
// max-height directly (not React state), so the page isn't re-rendered for it and it's never drawn in the wrong
// place first. `gap`: the space between the menu and what it's anchored to. `open`: only once the menu is
// actually rendered (e.g. open && its position is known).
export function useKeepMenuInView(open: boolean, menu: ElementSource, anchor: ElementSource, gap = 2): void {
  const place = () => {
    const menuEl = elementOf(menu);
    const anchorEl = elementOf(anchor);
    if (!menuEl || !anchorEl || typeof window === "undefined") return;
    // Its own max-height (from its classes or style) is what it gets wherever it fits — measured without
    // anything this set last time.
    if (menuEl.dataset.keepInViewMaxHeight === undefined) menuEl.dataset.keepInViewMaxHeight = menuEl.style.maxHeight;
    menuEl.style.maxHeight = menuEl.dataset.keepInViewMaxHeight;
    const height = menuEl.offsetHeight;
    const anchorRect = anchorEl.getBoundingClientRect();
    const vv = window.visualViewport;
    const visibleTop = (vv ? vv.offsetTop : 0) + EDGE_MARGIN_PX;
    const visibleBottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - EDGE_MARGIN_PX;
    const belowTop = anchorRect.bottom + gap;
    const roomBelow = visibleBottom - belowTop;
    const roomAbove = anchorRect.top - gap - visibleTop;
    if (height <= roomBelow || roomBelow >= roomAbove) {
      menuEl.style.top = `${Math.round(belowTop)}px`;
      if (height > roomBelow) menuEl.style.maxHeight = `${Math.max(0, Math.floor(roomBelow))}px`;
      return;
    }
    const fitHeight = Math.min(height, roomAbove);
    if (fitHeight < height) menuEl.style.maxHeight = `${Math.max(0, Math.floor(fitHeight))}px`;
    menuEl.style.top = `${Math.round(anchorRect.top - gap - fitHeight)}px`;
  };

  // After every render: the menu's own render can put its `top` back below the anchor.
  useLayoutEffect(() => {
    if (open) place();
  });

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const menuEl = elementOf(menu);
    const onChange = () => place();
    // (Its size settles after one placing: placing it again gives the same size, so this doesn't repeat.)
    const observer = typeof ResizeObserver === "undefined" || !menuEl ? null : new ResizeObserver(onChange);
    if (menuEl) observer?.observe(menuEl);
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    window.visualViewport?.addEventListener("resize", onChange);
    window.visualViewport?.addEventListener("scroll", onChange);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
      window.visualViewport?.removeEventListener("resize", onChange);
      window.visualViewport?.removeEventListener("scroll", onChange);
    };
    // Set up again each time it opens; `menu` / `anchor` are read fresh whenever it places.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
