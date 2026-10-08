"use client";

import { flushSync } from "react-dom";

// Collapsing / expanding a kanban column (Dashboard and Leads boards) as one movement instead of a
// swap: the column slides between its full width and the collapsed strip (the columns after it
// sliding along), and its collapse button rides the moving right edge — ending, collapsed, exactly
// where the sort button was (the strip's own expand button sits there, on the same line as the
// header's buttons) — its two arrows flipping round on the way (>< to <>; ColumnCollapseChevrons).
// Everything else in the column fades out as it goes, and the strip's count and status name fade in
// once it's there; expanding plays the same thing backwards.
//
// The two states are different markup (a header + cards vs. a narrow strip), both inside the same
// BoardColumnFrame slot (same key), so React keeps the slot and swaps what's in it. Collapsing plays
// on the full column and swaps at the end; expanding swaps first (flushSync, so the full column is
// already there to measure) and plays it back from the strip's look. The column's contents keep
// their full width throughout (cut off by the narrowing column, never squeezed), so nothing reflows.
//
// The button is the element marked data-column-collapse-button — in the full column, its collapse
// button; in the strip, its expand button. Everything that fades is everything else.

// The collapsed strip's width (its slot's w-[52px]).
export const COLLAPSED_BOARD_COLUMN_WIDTH = 52;
const DURATION_MS = 300;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const FADE_MS = 150;
const STRIP_FADE_IN_MS = 200;

// The column's surface: the rounded, coloured box inside the frame (a full column's, or the strip).
function getSurface(slot: HTMLElement) {
  return (slot.querySelector<HTMLElement>("[data-board-column-drop]")?.firstElementChild as HTMLElement | null) ?? null;
}

// Everything in the surface but the button: the button's siblings at each level up to the surface
// (in a full column: the count next to it, the header's title side, the card list).
function getEverythingButButton(surface: HTMLElement, button: HTMLElement) {
  const others: HTMLElement[] = [];
  for (let node: HTMLElement = button; node !== surface && node.parentElement; node = node.parentElement) {
    Array.from(node.parentElement.children).forEach((sibling) => {
      if (sibling !== node && sibling instanceof HTMLElement) others.push(sibling);
    });
  }
  return others;
}

type Prepared = {
  slot: HTMLElement;
  contentBlocks: HTMLElement[];
  button: HTMLElement;
  fading: HTMLElement[];
  // How far the button moves from its place in the full column to the strip's button spot.
  buttonShift: number;
  fullWidth: number;
};

// The full column's parts, measured as it is now.
function prepareFullColumn(slot: HTMLElement): Prepared | null {
  const surface = getSurface(slot);
  const button = surface?.querySelector<HTMLElement>("[data-column-collapse-button]");
  if (!surface || !button) return null;
  const slotRect = slot.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  return {
    slot,
    contentBlocks: Array.from(surface.children).filter((child): child is HTMLElement => child instanceof HTMLElement),
    button,
    fading: getEverythingButButton(surface, button),
    buttonShift: (COLLAPSED_BOARD_COLUMN_WIDTH - buttonRect.width) / 2 - (buttonRect.left - slotRect.left),
    fullWidth: slotRect.width,
  };
}

function freezeContentWidths(prepared: Prepared) {
  prepared.contentBlocks.forEach((block) => {
    block.style.width = `${block.getBoundingClientRect().width}px`;
    block.style.flexShrink = "0";
  });
}

function clearInlineStyles(prepared: Prepared) {
  const { slot, contentBlocks, button, fading } = prepared;
  ["width", "min-width", "max-width", "transition"].forEach((prop) => slot.style.removeProperty(prop));
  contentBlocks.forEach((block) => {
    block.style.removeProperty("width");
    block.style.removeProperty("flex-shrink");
  });
  button.style.removeProperty("transform");
  button.style.removeProperty("transition");
  delete button.dataset.columnChevronsFlipped;
  fading.forEach((el) => {
    el.style.removeProperty("opacity");
    el.style.removeProperty("transition");
  });
  delete slot.dataset.columnAnimating;
}

// Once collapsed: the strip's count and status name fade in around its button.
function fadeInStrip(slot: HTMLElement) {
  const surface = getSurface(slot);
  const button = surface?.querySelector<HTMLElement>("[data-column-collapse-button]");
  if (!surface || !button) return;
  const others = getEverythingButButton(surface, button);
  others.forEach((el) => {
    el.style.transition = "none";
    el.style.opacity = "0";
  });
  void surface.offsetWidth;
  others.forEach((el) => {
    el.style.transition = `opacity ${STRIP_FADE_IN_MS}ms ease`;
    el.style.opacity = "1";
  });
  window.setTimeout(() => {
    others.forEach((el) => {
      el.style.removeProperty("opacity");
      el.style.removeProperty("transition");
    });
  }, STRIP_FADE_IN_MS);
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The collapse button's click: slides the column into its strip, then collapses it (collapse()).
export function collapseBoardColumnAnimated(trigger: HTMLElement, collapse: () => void) {
  const slot = trigger.closest<HTMLElement>("[data-board-column]");
  if (!slot || prefersReducedMotion()) {
    collapse();
    return;
  }
  if (slot.dataset.columnAnimating) return;
  const prepared = prepareFullColumn(slot);
  if (!prepared) {
    collapse();
    return;
  }
  slot.dataset.columnAnimating = "true";
  freezeContentWidths(prepared);
  slot.style.width = `${prepared.fullWidth}px`;
  slot.style.minWidth = "0";
  slot.style.maxWidth = "none";
  void slot.offsetWidth;
  slot.style.transition = `width ${DURATION_MS}ms ${EASE}`;
  slot.style.width = `${COLLAPSED_BOARD_COLUMN_WIDTH}px`;
  prepared.button.style.transition = `transform ${DURATION_MS}ms ${EASE}`;
  prepared.button.style.transform = `translateX(${prepared.buttonShift}px)`;
  // >< turns into the strip's <> on the way (globals.css).
  prepared.button.dataset.columnChevronsFlipped = "true";
  prepared.fading.forEach((el) => {
    el.style.transition = `opacity ${FADE_MS}ms ease`;
    el.style.opacity = "0";
  });
  window.setTimeout(() => {
    // Swapped to the strip in one go — its expand button is where this one has just arrived, its
    // arrows already the way round this one's have just turned.
    flushSync(collapse);
    clearInlineStyles(prepared);
    if (slot.isConnected) fadeInStrip(slot);
  }, DURATION_MS);
}

// The collapsed strip's click: expands the column (expand()), then slides it out from the strip.
export function expandBoardColumnAnimated(trigger: HTMLElement, expand: () => void) {
  const slot = trigger.closest<HTMLElement>("[data-board-column]");
  if (!slot || prefersReducedMotion()) {
    expand();
    return;
  }
  if (slot.dataset.columnAnimating) return;
  flushSync(expand);
  // React keeps the slot (same key) and puts the full column in it.
  if (!slot.isConnected) return;
  const prepared = prepareFullColumn(slot);
  if (!prepared) return;
  slot.dataset.columnAnimating = "true";
  freezeContentWidths(prepared);
  slot.style.minWidth = "0";
  slot.style.maxWidth = "none";
  slot.style.width = `${COLLAPSED_BOARD_COLUMN_WIDTH}px`;
  prepared.button.style.transform = `translateX(${prepared.buttonShift}px)`;
  // Starts as the strip's <> (no turning yet), then turns back to >< as it goes.
  prepared.button.dataset.columnChevronsInstant = "true";
  prepared.button.dataset.columnChevronsFlipped = "true";
  prepared.fading.forEach((el) => {
    el.style.opacity = "0";
  });
  void slot.offsetWidth;
  prepared.button.querySelectorAll("path").forEach((path) => void getComputedStyle(path).transform);
  delete prepared.button.dataset.columnChevronsInstant;
  slot.style.transition = `width ${DURATION_MS}ms ${EASE}`;
  slot.style.width = `${prepared.fullWidth}px`;
  prepared.button.style.transition = `transform ${DURATION_MS}ms ${EASE}`;
  prepared.button.style.transform = "translateX(0)";
  delete prepared.button.dataset.columnChevronsFlipped;
  prepared.fading.forEach((el) => {
    el.style.transition = `opacity ${FADE_MS}ms ease ${DURATION_MS - FADE_MS}ms`;
    el.style.opacity = "1";
  });
  window.setTimeout(() => clearInlineStyles(prepared), DURATION_MS);
}
