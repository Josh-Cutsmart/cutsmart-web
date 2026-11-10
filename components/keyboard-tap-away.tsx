"use client";

import { useEffect } from "react";
import { expectsKeyboard } from "@/lib/use-keyboard-inset";

// A touch screen, anywhere in the app: while the keyboard's up (a text box has the cursor), a tap outside that box just puts
// the keyboard away — it doesn't also open, press or follow whatever it landed on. A tap, not a press: a finger that scrolls
// the page instead (no click comes of it) leaves the keyboard be.
//
// Still taken as they are, as they're part of typing:
//   - another text box (moving to it);
//   - the box's own bar (its icon, the app's X that clears it — components/search-clear-buttons.tsx);
//   - a list that drops down for it while typing (suggestions, a menu's options — role listbox / option / menu, the app's
//     glass dropdowns);
//   - anything marked data-keep-keyboard;
//   - a button made to keep the cursor in the box (its press stops the focus moving — mousedown's default prevented: a tag
//     suggestion, an editor's Bold or List, …);
//   - the box's own form's submit button (Log in, Send reset link, …) — sending what's been typed is what it's for.

const KEEP_SELECTOR = [
  "[data-search-clear-button]",
  "[data-keep-keyboard]",
  "[role='listbox']",
  "[role='option']",
  "[role='menu']",
  "[role='menuitem']",
  "[data-glass-dropdown-menu]",
  ".glass-menu-squeeze",
].join(", ");

// Another box the keyboard's for (or a label that puts the cursor in one).
function isOtherTextBox(target: Element): boolean {
  const box = target.closest<HTMLElement>("input, textarea, [contenteditable='true'], [contenteditable='']");
  if (box && expectsKeyboard(box)) return true;
  const label = target.closest("label");
  const forBox = label?.control ?? label?.querySelector("input, textarea");
  return Boolean(forBox && forBox instanceof HTMLElement && expectsKeyboard(forBox));
}

export function KeyboardTapAway() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    // The box whose keyboard a tap that's begun is to put away (cleared by the next press, or a second).
    let pending: { field: HTMLElement; atMs: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      pending = null;
      if (event.pointerType === "mouse") return;
      const field = document.activeElement;
      if (!(field instanceof HTMLElement) || !expectsKeyboard(field)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (field.contains(target) || isOtherTextBox(target) || target.closest(KEEP_SELECTOR)) return;
      // The box's own bar (its icon, its padding): the one marked open, or the label it's in.
      const bar = field.closest("[data-search-open], label");
      if (bar?.contains(target)) return;
      // Its own form's submit button.
      const submit = target.closest<HTMLButtonElement | HTMLInputElement>("button[type='submit'], input[type='submit']");
      const form = field.closest("form");
      if (submit && form && submit.form === form) return;
      pending = { field, atMs: Date.now() };
    };
    // The tap comes to a click: the keyboard's put away, and nothing else gets the click.
    const onClick = (event: MouseEvent) => {
      const tap = pending;
      pending = null;
      if (!tap || Date.now() - tap.atMs > 1000) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (document.activeElement === tap.field) tap.field.blur();
    };
    // A button made to keep the cursor in the box (it stops the press taking the focus): it's part of typing — let it be.
    // (Heard as the press reaches the document, after the page's own handlers have had it.)
    const onMouseDown = (event: MouseEvent) => {
      if (pending && event.defaultPrevented) pending = null;
    };
    // (A tap that became a scroll or was cancelled: no click — and nothing to do.)
    const onCancel = () => {
      pending = null;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointercancel", onCancel, true);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointercancel", onCancel, true);
    };
  }, []);
  return null;
}
