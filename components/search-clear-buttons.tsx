"use client";

import { useEffect } from "react";

// Every search box in the app, the same once it's open: while it's in use (the cursor in it, or something typed in it) its
// bar is marked open (data-search-open — globals.css gives every open bar the same look), and while there's text in it an
// X sits in the bar's right-hand end, clearing it — the same X, in the same place, in every bar: in the middle of the
// bar's rounded end (as far in from its right edge as half its height), whether the bar is the text box itself or a
// rounded box round it (with its icon). One place, rather than each of the app's many search boxes drawing its own.
//
// A search box is a text box whose placeholder or label says "search" (or a type="search" one). Not one marked
// data-no-search-clear, nor (as a safeguard) one that still has a clear or close button of its own. The X is drawn over
// the page, not inside the box (that's React's to lay out): placed over the bar's end each frame while it shows, the box's
// own text kept clear of it, and hidden whenever something else is over that spot (a pop-up, a menu) or the box isn't on
// screen. Clearing goes through the box itself, as typing would, so the page's own state empties with it.

const SIZE_PX = 20;
// The gap kept between the box's text and the X.
const TEXT_GAP_PX = 4;
const X_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="pointer-events:none"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

function isSearchBox(el: EventTarget | null): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type !== "text" && el.type !== "search") return false;
  if (el.disabled || el.readOnly || el.closest("[data-no-search-clear]")) return false;
  const words = `${el.placeholder} ${el.getAttribute("aria-label") ?? ""}`.toLowerCase();
  return el.type === "search" || words.includes("search");
}

// Whether it still has a clear / close button of its own beside it.
function hasOwnClearButton(el: HTMLInputElement): boolean {
  const near = el.parentElement?.parentElement ?? el.parentElement;
  if (!near) return false;
  return Array.from(near.querySelectorAll<HTMLElement>("button, [role='button']")).some(
    (button) =>
      !button.hasAttribute("data-search-clear-button") &&
      /\b(clear search|close search)\b/i.test(`${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""}`),
  );
}

const isSeen = (color: string) => color !== "transparent" && !/rgba?\([^)]*,\s*0\)$/.test(color.replace(/\s+/g, " "));

// The bar you see: the box itself if it's drawn (an edge or a fill), else the nearest box round it that is — its rounded
// box with the icon in it — no more than a little taller than it.
function barOf(input: HTMLInputElement): HTMLElement {
  const inputRect = input.getBoundingClientRect();
  let el: HTMLElement | null = input;
  for (let depth = 0; el && depth < 4; depth += 1, el = el.parentElement) {
    const style = getComputedStyle(el);
    const drawn =
      (Number.parseFloat(style.borderTopWidth) > 0 && isSeen(style.borderTopColor)) ||
      isSeen(style.backgroundColor) ||
      style.backgroundImage !== "none" ||
      el.classList.contains("glass-shine");
    if (!drawn) continue;
    if (el === input) return input;
    const rect = el.getBoundingClientRect();
    if (rect.height <= inputRect.height + 20 && rect.left <= inputRect.left + 1 && rect.right >= inputRect.right - 1) return el;
  }
  return input;
}

type Shown = { button: HTMLButtonElement; paddingBefore: string; padded: boolean };

export function SearchClearButtons() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const watched = new Set<HTMLInputElement>();
    const shown = new Map<HTMLInputElement, Shown>();
    // Each box's bar, as marked open (to unmark it again).
    const openBars = new Map<HTMLInputElement, HTMLElement>();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    let frame = 0;

    const clear = (input: HTMLInputElement) => {
      // As if it had been typed away: the page's onChange sees it (React's own value tracking included).
      valueSetter?.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus({ preventScroll: true });
    };
    const makeButton = (input: HTMLInputElement): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", "Clear search");
      button.setAttribute("data-search-clear-button", "true");
      button.innerHTML = X_ICON;
      Object.assign(button.style, {
        position: "fixed",
        left: "0px",
        top: "0px",
        width: `${SIZE_PX}px`,
        height: `${SIZE_PX}px`,
        display: "none",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "999px",
        border: "none",
        padding: "0",
        margin: "0",
        cursor: "pointer",
        // The top layer, as the menus whose search boxes it sits in are (a dropdown's search — the staff picker's, a piece's
        // edge menu's): below them it'd be hidden under its own box. Safe so high, as it's only shown when nothing's over
        // its box (place's check), and as it's added after the menu, it's the one drawn on top.
        zIndex: "2147483647",
        // Just the X: no background, in the grey of the box's search icon.
        color: "var(--text-muted)",
        backgroundColor: "transparent",
      } as Partial<CSSStyleDeclaration>);
      // (Keeping the focus in the box, so a phone's keyboard stays up.)
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        clear(input);
      });
      document.body.appendChild(button);
      return button;
    };
    const hide = (input: HTMLInputElement) => {
      const entry = shown.get(input);
      if (!entry) return;
      entry.button.remove();
      if (entry.padded) input.style.paddingRight = entry.paddingBefore;
      shown.delete(input);
    };
    const setOpen = (input: HTMLInputElement, open: boolean) => {
      const marked = openBars.get(input);
      if (!open) {
        if (marked) marked.removeAttribute("data-search-open");
        openBars.delete(input);
        return;
      }
      const bar = input.isConnected ? barOf(input) : null;
      if (marked && marked !== bar) marked.removeAttribute("data-search-open");
      if (!bar) return;
      bar.setAttribute("data-search-open", "true");
      openBars.set(input, bar);
    };

    const place = () => {
      frame = 0;
      for (const input of Array.from(watched)) {
        const focused = document.activeElement === input;
        const has = input.isConnected && input.value !== "";
        setOpen(input, input.isConnected && (focused || has));
        // (A box that's put its own back since it was typed in: that one's used instead.)
        if (!has || hasOwnClearButton(input)) {
          hide(input);
          if (!input.isConnected || !focused) {
            setOpen(input, false);
            watched.delete(input);
          }
          continue;
        }
        let entry = shown.get(input);
        if (!entry) {
          entry = { button: makeButton(input), paddingBefore: input.style.paddingRight, padded: false };
          shown.set(input, entry);
        }
        const bar = openBars.get(input) ?? barOf(input);
        const rect = bar.getBoundingClientRect();
        // In the middle of the bar's rounded end: as far in from its right edge as half its height (up to 20px).
        const middleX = rect.right - Math.min(rect.height / 2, 20);
        const middleY = rect.top + rect.height / 2;
        const x = middleX - SIZE_PX / 2;
        const y = middleY - SIZE_PX / 2;
        // On screen, wide enough, and nothing over that end of it (a pop-up, a menu, a button of its own).
        let visible = rect.width > 60 && rect.height > 0 && middleX > 0 && middleY > 0 && middleX < window.innerWidth && middleY < window.innerHeight;
        if (visible) {
          // (Not counting an X itself, its icon included.)
          const top = document.elementsFromPoint(middleX, middleY).find((el) => !el.closest("[data-search-clear-button]"));
          visible = Boolean(top) && (top === input || bar.contains(top as Node));
        }
        entry.button.style.display = visible ? "inline-flex" : "none";
        if (visible) {
          entry.button.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
          if (!entry.padded) {
            // The box's text kept clear of the X: room from the X's left edge to the box's own right edge.
            const inputRect = input.getBoundingClientRect();
            const room = Math.ceil(inputRect.right - x + TEXT_GAP_PX);
            const padding = Number.parseFloat(getComputedStyle(input).paddingRight) || 0;
            if (room > padding) input.style.paddingRight = `${room}px`;
            entry.padded = true;
          }
        }
      }
      if (watched.size) frame = window.requestAnimationFrame(place);
    };
    // (Straight away, as it's typed in or gone into — then kept in place each frame while it's open.)
    const placeNow = () => {
      if (frame) window.cancelAnimationFrame(frame);
      place();
    };
    const onTyped = (event: Event) => {
      const input = event.target;
      if (!isSearchBox(input) || hasOwnClearButton(input)) return;
      watched.add(input);
      placeNow();
    };
    // Left: shut (if it's empty) once the focus has moved on.
    const onLeft = (event: Event) => {
      if (!watched.has(event.target as HTMLInputElement)) return;
      window.setTimeout(placeNow, 0);
    };
    document.addEventListener("input", onTyped, true);
    document.addEventListener("focusin", onTyped, true);
    document.addEventListener("focusout", onLeft, true);
    return () => {
      document.removeEventListener("input", onTyped, true);
      document.removeEventListener("focusin", onTyped, true);
      document.removeEventListener("focusout", onLeft, true);
      if (frame) window.cancelAnimationFrame(frame);
      for (const input of Array.from(shown.keys())) hide(input);
      for (const input of Array.from(openBars.keys())) setOpen(input, false);
    };
  }, []);
  return null;
}
