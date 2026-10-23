"use client";

import { useEffect } from "react";

// Every dropdown squeezes out of what opened it — the one shared animation (.glass-menu-squeeze, app/globals.css), for
// all of them: a menu or list that opens floating over the page (portalled to <body>, position: fixed — every
// dropdown's, the app's own and each page's) starts flat and narrow at the edge nearest the button that opened it (its
// top opening downward, its bottom opening upward, across where the button was pressed — a menu at the pointer, such
// as a right-click one, from the pointer), then springs open. A menu or list (role, or a glass menu's mark) anywhere it
// opens; anything else floating that opens right against what was just pressed (a list under its button, a field's
// suggestions under it — one without a role) too, unless it's big (a pop-up) or animates its own way. One that already
// has the animation (GLASS_MENU_CLASS's) gets where it squeezes from worked out too, unless it sets that itself
// (GlassDropdown's, the board sort menu's — they know exactly where they came from); one marked data-no-squeeze="true"
// isn't squeezed.

const MENU_SELECTOR = '[role="menu"], [role="listbox"], [data-glass-dropdown-menu="true"], [data-status-menu="true"]';
// A menu that appears this soon after a press (or key) is the one it opened.
const OPENED_BY_WITHIN_MS = 1500;
const TRIGGER_SELECTOR = 'button, [role="button"], [aria-haspopup], input, textarea, select, a, [tabindex]';
// Something floating without a menu's role is a dropdown when it opens this close against its button (above or below,
// across from it) and isn't nearly as big as the screen.
const AGAINST_TRIGGER_PX = 24;
const MAX_SCREEN_SHARE = 0.85;

type Press = { x: number; y: number; trigger: DOMRect | null; at: number };

const clamp = (value: number, max: number) => Math.round(Math.min(max, Math.max(0, value)));

export function DropdownSqueezeWatcher() {
  useEffect(() => {
    let lastPress: Press | null = null;
    const onPointerDown = (event: PointerEvent) => {
      const trigger = event.target instanceof Element ? event.target.closest(TRIGGER_SELECTOR) : null;
      lastPress = { x: event.clientX, y: event.clientY, trigger: trigger ? trigger.getBoundingClientRect() : null, at: Date.now() };
    };
    // Opened from the keyboard (or by typing — a field's suggestions): from what has the focus.
    const onKeyDown = () => {
      const focused = document.activeElement;
      if (!(focused instanceof Element) || focused === document.body) return;
      const rect = focused.getBoundingClientRect();
      lastPress = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, trigger: rect, at: Date.now() };
    };

    // `isMenu`: a menu or list by its role or mark — anything else, only one against what opened it.
    const squeeze = (menu: HTMLElement, isMenu: boolean) => {
      if (menu.style.transformOrigin || menu.dataset.noSqueeze === "true") return;
      if (!lastPress || Date.now() - lastPress.at > OPENED_BY_WITHIN_MS) return;
      if (!isMenu && !lastPress.trigger) return;
      // One that already has the animation is measured without it (it's squashed from its first frame), then it starts
      // again from where it should.
      const hadAnimation = menu.classList.contains("glass-menu-squeeze");
      if (hadAnimation) menu.style.animation = "none";
      const restart = () => {
        if (!hadAnimation) return;
        void menu.offsetWidth;
        menu.style.animation = "";
      };
      const style = getComputedStyle(menu);
      // (Not one placed by a transform of its own — the squeeze's would take its place while it ran — nor one with an
      // animation of its own.)
      if (style.position !== "fixed" || style.transform !== "none" || (!hadAnimation && style.animationName !== "none")) {
        restart();
        return;
      }
      const rect = menu.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        restart();
        return;
      }
      const trigger = lastPress.trigger;
      if (!isMenu) {
        const across = trigger && rect.left < trigger.right && rect.right > trigger.left;
        const below = trigger && rect.top - trigger.bottom >= -2 && rect.top - trigger.bottom <= AGAINST_TRIGGER_PX;
        const above = trigger && trigger.top - rect.bottom >= -2 && trigger.top - rect.bottom <= AGAINST_TRIGGER_PX;
        const small = rect.width < window.innerWidth * MAX_SCREEN_SHARE && rect.height < window.innerHeight * MAX_SCREEN_SHARE;
        if (!across || !(below || above) || !small) {
          restart();
          return;
        }
      }
      // Across: where it was pressed (a key: the middle of what has the focus) — a wide button's half, its own spot.
      const x = clamp(lastPress.x - rect.left, rect.width);
      let origin: string;
      if (trigger && rect.top >= trigger.bottom - 2) {
        origin = `${x}px 0%`;
      } else if (trigger && rect.bottom <= trigger.top + 2) {
        origin = `${x}px 100%`;
      } else {
        // Over what opened it (a right-click menu at the pointer, a menu beside its button): from the press itself.
        origin = `${x}px ${clamp(lastPress.y - rect.top, rect.height)}px`;
      }
      menu.style.transformOrigin = origin;
      if (hadAnimation) restart();
      else menu.classList.add("glass-menu-squeeze");
    };

    // Floating menus are portalled straight into <body> — a new one there (or a menu in what was added there) is
    // squeezed.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          squeeze(node, node.matches(MENU_SELECTOR));
          node.querySelectorAll<HTMLElement>(MENU_SELECTOR).forEach((menu) => squeeze(menu, true));
        });
      }
    });
    observer.observe(document.body, { childList: true });
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
  return null;
}
