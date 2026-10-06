"use client";

import { useEffect } from "react";

// What counts as an open pop-up: anything using .glass-modal-backdrop, a custom overlay marked
// data-scroll-lock="true", or one of the app's own click-to-close backdrops (aria-label "… backdrop" /
// data-swipe-backdrop — drawers, the dashboard's Completed/Staff pop-ups, Version History, etc.). The
// mobile nav drawer's backdrop stays mounted while closed, but its container is `inert` then, hence the
// :not([inert] *).
const OPEN_POPUP_SELECTOR =
  '.glass-modal-backdrop, [data-scroll-lock="true"], [aria-label$="backdrop"]:not([inert] *), [data-swipe-backdrop="true"]:not([inert] *)';
const LOCKED_CLASS = "cs-scroll-locked";

// Whether any pop-up is open right now (by the same definition as above) — for gestures that belong to
// the page behind one, like AppShell's pull-down menu and drawer swipes, to stand down.
export function isAnyPopupOpen(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains(LOCKED_CLASS);
}

// Puts LOCKED_CLASS on <html> while any pop-up is open, so the page behind it can't scroll (the rules
// are in app/globals.css). This used to be a CSS `html:has(…)` selector, which made the browser re-check
// the whole page against it after DOM changes all over the app; now the check runs at most once a frame,
// and only after something was added, removed or had one of the relevant attributes changed. Rendered
// once, in the root layout.
export function ScrollLockWatcher() {
  useEffect(() => {
    const root = document.documentElement;
    let frame: number | null = null;
    const check = () => {
      frame = null;
      root.classList.toggle(LOCKED_CLASS, document.querySelector(OPEN_POPUP_SELECTOR) !== null);
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(check);
    };
    check();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "inert", "aria-label", "data-scroll-lock", "data-swipe-backdrop"],
    });
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      root.classList.remove(LOCKED_CLASS);
    };
  }, []);
  return null;
}
