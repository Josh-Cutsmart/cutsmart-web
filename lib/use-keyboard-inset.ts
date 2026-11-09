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

// Called right after a pop-up panel has been capped to the space above the keyboard (or, a phone's full-screen
// pop-up — data-phone-fullscreen in globals.css — held in place under it), and when another field is tapped with
// the keyboard already up. The cap can turn part of the panel into a scroll area, and the browser only scrolled the
// focused field into view at the moment it was focused (before the cap) — so bring it back into the visible part of
// whichever scroll area(s) inside the panel now hold it. Visible: inside the scroll area, and on screen above the
// keyboard (a full-screen pop-up's scroll area reaches down behind it).
// A pop-up that reaches down behind the keyboard on a phone: a full-screen one (data-phone-fullscreen, and every pop-up
// on a phone but those keeping their box), or a bottom sheet (data-phone-keep-box — the cutlist's) — see app/globals.css.
const BEHIND_KEYBOARD_PANEL = '.glass-modal-panel[data-phone-keep-box="true"]';

// What scrolls in a phone's pop-up (its outermost scrolling part, or the pop-up itself) given room at the bottom for what the
// keyboard covers (data-keyboard-scroll-pad — app/globals.css), so the field being typed in can reach the middle of what's
// visible. Marked as it's needed, and taken off as the keyboard goes.
const AUTO_SCROLL_PAD_ATTR = "data-keyboard-scroll-pad-auto";
const ASSUMED_ROOM_ATTR = "data-keyboard-scroll-room";
const ASSUMED_ROOM_SHARE = 0.6;
const PANEL_LISTS = ".overflow-y-auto, .overflow-auto, .overflow-y-scroll, .overflow-scroll, .glass-scroll";
const ASSUMED_VISIBLE_SHARE = 0.52;
const MOST_SCROLLER_TOP_SHARE = 0.3;
const MOST_LIFTED_FIELD_SHARE = 0.4;

function giveFocusedPanelScrollRoom(): void {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || !window.matchMedia("(max-width: 639.98px)").matches) return;
  const panel = field.closest<HTMLElement>(".glass-modal-panel");
  if (!panel || panel.dataset.phoneDrop === "true") return;
  let scroller: HTMLElement = panel;
  for (let node = field.parentElement; node && node !== panel; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") scroller = node;
  }
  // A box with nothing scrolling round it (a search at the top of a pop-up, a list below it). What scrolls is what gets the room, so
  // the list carries on under the keyboard and reaches its end, and the pop-up stays as it is unless the box itself needs lifting.
  const vv = window.visualViewport;
  if (scroller === panel && vv && expectsKeyboard(field)) {
    panel.querySelectorAll<HTMLElement>(PANEL_LISTS).forEach((list) => {
      const { overflowY } = getComputedStyle(list);
      if (overflowY === "auto" || overflowY === "scroll") giveAssumedRoom(list);
    });
    if (field.getBoundingClientRect().bottom + REVEAL_MARGIN_PX <= visibleBottomFor(field, vv)) return;
  }
  if (expectsKeyboard(field)) giveAssumedRoom(scroller);
  if (scroller.getAttribute("data-keyboard-scroll-pad") === "true") return;
  scroller.setAttribute("data-keyboard-scroll-pad", "true");
  scroller.setAttribute(AUTO_SCROLL_PAD_ATTR, "true");
}

// (Set here as well as by the stylesheet: that waits on the keyboard being reported as up, and a phone doesn't always say.)
function giveAssumedRoom(node: HTMLElement): void {
  if (node.hasAttribute(ASSUMED_ROOM_ATTR)) return;
  node.setAttribute(ASSUMED_ROOM_ATTR, "true");
  node.style.setProperty("padding-bottom", `${Math.round(window.innerHeight * ASSUMED_ROOM_SHARE)}px`, "important");
}

function clearPanelScrollRoom(): void {
  document.querySelectorAll<HTMLElement>(`[${AUTO_SCROLL_PAD_ATTR}]`).forEach((node) => {
    node.removeAttribute(AUTO_SCROLL_PAD_ATTR);
    node.removeAttribute("data-keyboard-scroll-pad");
  });
  document.querySelectorAll<HTMLElement>(`[${ASSUMED_ROOM_ATTR}]`).forEach((node) => {
    node.removeAttribute(ASSUMED_ROOM_ATTR);
    node.style.removeProperty("padding-bottom");
  });
}

// Where the bottom of what can be seen is, for a box in a phone's pop-up. A box that brings the keyboard up: never lower than the
// top half of the screen, whatever the phone reports, because it doesn't always report the keyboard, or not straight away.
function visibleBottomFor(field: HTMLElement, vv: VisualViewport): number {
  const height = expectsKeyboard(field) && isPhoneWidth() ? Math.min(vv.height, window.innerHeight * ASSUMED_VISIBLE_SHARE) : vv.height;
  return vv.offsetTop + height;
}

function revealFocusedFieldInPanel(): void {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || !field.closest(".glass-modal-panel")) return;
  scrollFocusedFieldIntoPanelView(field);
  // A short pop-up can sit wholly behind the keyboard, or have a scrolling part too short to bring the box up: room on the
  // pop-up itself makes it taller, which puts it on top of the keyboard.
  const vv = window.visualViewport;
  const panel = field.closest<HTMLElement>(".glass-modal-panel");
  if (!vv || !panel || panel.dataset.phoneDrop === "true" || !window.matchMedia("(max-width: 639.98px)").matches) return;
  if (field.getBoundingClientRect().bottom + REVEAL_MARGIN_PX <= visibleBottomFor(field, vv)) return;
  if (panel.getAttribute("data-keyboard-scroll-pad") !== "true" && document.documentElement.hasAttribute(KEYBOARD_OPEN_ATTR)) {
    panel.setAttribute("data-keyboard-scroll-pad", "true");
    panel.setAttribute(AUTO_SCROLL_PAD_ATTR, "true");
    scrollFocusedFieldIntoPanelView(field);
  }
  liftPanelToField(field, panel, vv);
}

// Scrolling hasn't brought it above the keyboard: the whole pop-up moved up until it is. Taken off as the keyboard goes.
const PANEL_LIFT_ATTR = "data-keyboard-lifted";
function liftPanelToField(field: HTMLElement, panel: HTMLElement, vv: VisualViewport): void {
  const rect = field.getBoundingClientRect();
  const over = rect.bottom + REVEAL_MARGIN_PX - visibleBottomFor(field, vv);
  const lifted = Number.parseFloat(panel.dataset.keyboardLifted ?? "0") || 0;
  // Lifted too far (something else has moved it up as well, like a popover keeping itself above the keyboard): back down.
  const overTop = vv.offsetTop + REVEAL_MARGIN_PX - rect.top;
  if (over <= 0 && overTop > 0 && lifted > 0) {
    const lower = Math.max(0, lifted - overTop);
    panel.dataset.keyboardLifted = String(lower);
    panel.style.translate = `0 ${-lower}px`;
    return;
  }
  // (Not something too tall to fit, like a whole notes editor: that would only carry it off the top.)
  if (over <= 0 || rect.height > window.innerHeight * MOST_LIFTED_FIELD_SHARE) return;
  const next = lifted + over;
  panel.dataset.keyboardLifted = String(next);
  panel.style.translate = `0 ${-next}px`;
}
function clearPanelLifts(): void {
  document.querySelectorAll<HTMLElement>(`[${PANEL_LIFT_ATTR}]`).forEach((panel) => {
    panel.removeAttribute(PANEL_LIFT_ATTR);
    panel.style.translate = "";
  });
}

// Dev mode only, while the keyboard's up: what the phone is reporting, along the top of the screen. To work out a box the
// keyboard still hides on a real phone, which a simulated keyboard can't show.
let keyboardReadout: HTMLElement | null = null;
let watchTicks = 0;
let fieldAim = "none";
function showKeyboardReadout(vv: VisualViewport): void {
  let devOn = false;
  try {
    devOn = window.localStorage.getItem("cutsmart-dev-mode") === "1";
  } catch {
    devOn = false;
  }
  const field = document.activeElement;
  if (!devOn || !(field instanceof HTMLElement) || !isTextEntry(field)) {
    keyboardReadout?.remove();
    keyboardReadout = null;
    return;
  }
  if (!keyboardReadout) {
    keyboardReadout = document.createElement("div");
    keyboardReadout.style.cssText =
      "position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:4px 8px;font:11px/1.3 monospace;background:rgba(0,0,0,.8);color:#fff;pointer-events:none;white-space:pre-wrap";
    document.body.appendChild(keyboardReadout);
  }
  const panel = field.closest<HTMLElement>(".glass-modal-panel");
  let scroller: HTMLElement | null = null;
  for (let node = field.parentElement; node && node !== panel; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") scroller = node;
  }
  const r = field.getBoundingClientRect();
  const root = getComputedStyle(document.documentElement);
  keyboardReadout.style.transform = `translateY(${vv.offsetTop}px)`;
  keyboardReadout.textContent = [
    `screen ${window.screen.height} win ${window.innerHeight} scrollY ${Math.round(window.scrollY)} | vv h ${Math.round(vv.height)} top ${Math.round(vv.offsetTop)} scale ${vv.scale.toFixed(2)}`,
    `vars inset ${root.getPropertyValue("--keyboard-inset-px")} top ${root.getPropertyValue("--keyboard-offset-top-px")} open ${document.documentElement.hasAttribute(KEYBOARD_OPEN_ATTR)}`,
    `box ${Math.round(r.top)}-${Math.round(r.bottom)} sees to ${Math.round(vv.offsetTop + vv.height)} aims for ${Math.round(visibleBottomFor(field, vv))}`,
    panel ? `panel ${Math.round(panel.getBoundingClientRect().top)}-${Math.round(panel.getBoundingClientRect().bottom)} lift ${panel.dataset.keyboardLifted ?? 0} pad ${getComputedStyle(panel).paddingBottom}` : "no panel",
    scroller ? `scroll ${Math.round(scroller.scrollTop)}/${scroller.scrollHeight - scroller.clientHeight} pad ${getComputedStyle(scroller).paddingBottom}` : "no scroller",
    `checks ${watchTicks} aim ${fieldAim}`,
  ].join("\n");
}

function scrollFocusedFieldIntoPanelView(field: HTMLElement): void {
  // (A pop-up reaching behind the keyboard: the field centred in what's visible above it, as a page's are. A capped one's
  // scroll area is all above it already: just into view.)
  const vv = window.visualViewport;
  const behindKeyboard = Boolean(field.closest(BEHIND_KEYBOARD_PANEL)) || isPhoneFullscreenPanel(field);
  const visibleTop = vv && behindKeyboard ? vv.offsetTop : -Infinity;
  const visibleBottom = vv && behindKeyboard ? visibleBottomFor(field, vv) : Infinity;
  for (let node = field.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      const box = node.getBoundingClientRect();
      const rect = field.getBoundingClientRect();
      if (vv && behindKeyboard && expectsKeyboard(field)) {
        aimFieldInScroller(field, rect, box, node, vv);
      } else {
        const top = Math.max(box.top, visibleTop);
        const bottom = Math.min(box.bottom, visibleBottom);
        if (behindKeyboard && bottom - top > rect.height + REVEAL_MARGIN_PX * 2) {
          const target = top + (bottom - top - rect.height) / 2;
          node.scrollTop += rect.top - target;
        } else if (rect.bottom > bottom) node.scrollTop += rect.bottom - bottom + REVEAL_MARGIN_PX;
        else if (rect.top < top) node.scrollTop -= top - rect.top + REVEAL_MARGIN_PX;
      }
    }
    if (node.classList.contains("glass-modal-panel")) return;
  }
}

// A box the keyboard's coming up for, in what it scrolls in: to the middle of the part of that above the keyboard. Worked out from
// where the box is inside what scrolls it, which is the same wherever the screen's been moved to, and the screen's position only
// within limits, so a wrong number from the phone can't leave it behind the keyboard.
function aimFieldInScroller(field: HTMLElement, rect: DOMRect, box: DOMRect, node: HTMLElement, vv: VisualViewport): void {
  const aimTop = Math.min(Math.max(box.top - vv.offsetTop, 0), window.innerHeight * MOST_SCROLLER_TOP_SHARE);
  const aimHeight = Math.min(vv.height, window.innerHeight * ASSUMED_VISIBLE_SHARE) - aimTop;
  const middle = Math.max(REVEAL_MARGIN_PX, (aimHeight - rect.height) / 2);
  let inBox = Math.min(middle, Math.max(REVEAL_MARGIN_PX, (box.height - rect.height) / 2));
  // Too tall to fit (a box that's grown as it's typed in): its end, where the typing is, above the keyboard.
  const typingAtEnd = field instanceof HTMLTextAreaElement && field.selectionStart === field.value.length;
  if (typingAtEnd && rect.height > aimHeight - REVEAL_MARGIN_PX * 2) inBox = aimHeight - rect.height - REVEAL_MARGIN_PX;
  const delta = rect.top - box.top - inBox;
  if (Math.abs(delta) >= 1) node.scrollTop += delta;
  fieldAim = `${Math.round(node.scrollTop)} (moved ${Math.round(delta)})`;
}

// A phone's pop-up shown as the whole screen without being marked so (globals.css: every pop-up on a phone but those
// keeping their box).
function isPhoneFullscreenPanel(field: HTMLElement): boolean {
  const panel = field.closest<HTMLElement>(".glass-modal-panel");
  return Boolean(panel) && panel!.dataset.phoneKeepBox !== "true" && panel!.dataset.phoneDrop !== "true" && window.matchMedia("(max-width: 639.98px)").matches;
}

// A notes box (data-keyboard-center — a lead's new note, a project's Notes cards) being typed in with the keyboard up:
// brought to the middle of what's visible above the keyboard — the box centred if it fits (or, taller, its top just
// under whatever's over the top of it: a page's stuck title bars), by scrolling whatever scrolls it. Where there isn't
// enough below it to scroll that far (a box near the end of a page, or of a phone's full-screen pop-up), room's added
// at the end of that scroll area while the keyboard's up (data-keyboard-room — app/globals.css). Left where the
// browser put it, it was often behind the keyboard.
const CENTER_MARGIN_PX = 12;
const KEYBOARD_ROOM_ATTR = "data-keyboard-room";
const KEYBOARD_ROOM_VAR = "--keyboard-room-px";

// What's being typed in, to bring to the middle: a notes box (data-keyboard-center) — or, on a touch screen, any text box
// on a page (not in a pop-up, which looks after its own; not in a bar pinned over the page — a sticky search — which
// scrolling can't move; not marked data-keyboard-center="off").
const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "tel", "url", "number", "password", "date", "time", "datetime-local"]);

function isTextEntry(el: HTMLElement): boolean {
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type) && !el.readOnly;
}

// A box a touch screen's keyboard comes up for (a date or time shows the phone's own picker instead). (Also used by
// components/keyboard-tap-away.tsx.)
export function expectsKeyboard(el: HTMLElement): boolean {
  if (!isTextEntry(el) || !window.matchMedia("(pointer: coarse)").matches) return false;
  if (el.getAttribute("inputmode") === "none") return false;
  return !(el instanceof HTMLInputElement && (el.type === "date" || el.type === "time" || el.type === "datetime-local"));
}

// In something held over the page that nothing can scroll it in. (A fixed drawer with a scrolling part round the box isn't: that
// scrolls it like a page.)
function inPinnedBar(el: HTMLElement): boolean {
  return pinnedHostOf(el) !== null;
}

function pinnedHostOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const { position, overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return null;
    if (position === "sticky" || position === "fixed") return node;
  }
  return null;
}

// Whether anything but the document itself scrolls it. A page with none (a public page, scrolled by the document) is left to the
// phone: nothing here can bring its box up, and putting the screen back would throw away where they'd scrolled to.
function hasOwnScrollArea(el: HTMLElement): boolean {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return true;
  }
  return false;
}

// An invisible text box holding the phone's keyboard until an editor has started (a project's Notes): placed as the box it's
// standing in for.
const standInBoxes = new WeakMap<HTMLElement, HTMLElement>();
export function markKeyboardStandIn(standIn: HTMLElement, box: HTMLElement | null): void {
  if (box) standInBoxes.set(standIn, box);
}

function focusedKeyboardCenterBox(): HTMLElement | null {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement)) return null;
  const standingInFor = standInBoxes.get(field);
  if (standingInFor) return standingInFor;
  const marked = field.closest<HTMLElement>("[data-keyboard-center]");
  if (marked) return marked.dataset.keyboardCenter === "off" ? null : marked;
  if (!expectsKeyboard(field)) return null;
  if (field.closest(".glass-modal-panel") || inPinnedBar(field) || !hasOwnScrollArea(field)) return null;
  return field;
}

// The cursor in an editor: above the keyboard as it's typed, whatever size the editor's grown to.
function caretRectIn(field: HTMLElement): { top: number; bottom: number } | null {
  const selection = window.getSelection();
  if (!field.isContentEditable || !selection?.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (!field.contains(range.endContainer)) return null;
  range.collapse(false);
  const rects = range.getClientRects();
  const last = rects.length ? rects[rects.length - 1] : null;
  if (last && last.bottom) return last;
  // (An empty line has no position of its own: where the line is.)
  const node = range.endContainer;
  const line = node instanceof HTMLElement ? node : node.parentElement;
  if (!line || line.getBoundingClientRect().height > CARET_LINE_MOST_PX) return null;
  return line.getBoundingClientRect();
}

// Where what can be seen starts, for this box: under the top of whatever scrolls it, and the headers stuck over that.
const STUCK_HEADERS = '[data-title-bar-stuck], .glass-page-header, [data-title-bar="true"]';
function visibleTopFor(field: HTMLElement, vv: VisualViewport): number {
  let top = vv.offsetTop;
  for (let node = field.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    top = Math.max(top, node.getBoundingClientRect().top);
    node.querySelectorAll<HTMLElement>(STUCK_HEADERS).forEach((bar) => {
      if (getComputedStyle(bar).position === "sticky" && !bar.contains(field)) top = Math.max(top, bar.getBoundingClientRect().bottom);
    });
  }
  if (!field.closest(".glass-modal-panel")) {
    const appBar = document.querySelector<HTMLElement>('[data-app-top-bar="true"]');
    if (appBar) top = Math.max(top, appBar.getBoundingClientRect().bottom);
  }
  return top;
}

// Dragged out of sight while it still has the focus. What's being typed at, that is: the cursor in an editor; the box otherwise, or
// for a box too tall to all fit (a cursor in a plain box can't be told), only once none of it's showing.
function typingOutOfSight(field: HTMLElement, vv: VisualViewport): boolean {
  const top = visibleTopFor(field, vv);
  const bottom = visibleBottomFor(field, vv);
  const caret = caretRectIn(field);
  if (caret) return caret.top < top || caret.bottom > bottom;
  const rect = field.getBoundingClientRect();
  if (rect.height > bottom - top) return rect.bottom <= top || rect.top >= bottom;
  return rect.top < top || rect.bottom > bottom;
}

function keepCaretClear(field: HTMLElement): void {
  const vv = window.visualViewport;
  if (!vv || !isPhoneWidth()) return;
  const caret = caretRectIn(field);
  if (!caret) return;
  // Dragged down past it: back up to it. (Below, as it's typed: further on.)
  let above = visibleTopFor(field, vv) + REVEAL_MARGIN_PX - caret.top;
  for (let node: HTMLElement | null = field; node && node !== document.body && above > 0.5; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowY !== "auto" && style.overflowY !== "scroll") continue;
    const before = node.scrollTop;
    node.scrollTop -= above;
    above -= before - node.scrollTop;
  }
  let over = caret.bottom + REVEAL_MARGIN_PX - visibleBottomFor(field, vv);
  for (let node: HTMLElement | null = field; node && node !== document.body && over > 0.5; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowY !== "auto" && style.overflowY !== "scroll") continue;
    // (Measured again after adding it, as centerFocusedNotesBox: room only counts once it's past what already reaches beyond the
    // end of the flow.)
    for (let tries = 0; node !== field && tries < 3; tries += 1) {
      const short = node.scrollTop + over - (node.scrollHeight - node.clientHeight);
      if (short <= 0.5) break;
      const roomBefore = node.style.getPropertyValue(KEYBOARD_ROOM_VAR);
      addKeyboardRoom(node, style, short);
      if (node.style.getPropertyValue(KEYBOARD_ROOM_VAR) === roomBefore) break;
    }
    const before = node.scrollTop;
    node.scrollTop += over;
    over -= node.scrollTop - before;
  }
}

// The keyboard going, on every page: sticky headers measured and drawn again. A page's header glass is measured on scroll and on
// the window resizing, neither of which a phone's keyboard closing has to set off, and a phone can stop drawing a blur layer as the
// keyboard moves. Either way it left the header's words with nothing behind them.
const HEADER_GLASS = '.glass-page-header, [data-app-top-bar-glass], [data-title-bar], [data-title-bar-stuck], [style*="backdrop-filter"]';
let headerRefreshTimers: number[] = [];
function refreshHeadersAfterKeyboard(): void {
  headerRefreshTimers.forEach((timer) => window.clearTimeout(timer));
  headerRefreshTimers = HEADER_REFRESH_MS.map((ms) =>
    window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
      document.querySelectorAll<HTMLElement>(HEADER_GLASS).forEach((glass) => {
        // Just what's held over the page with a blur. (That's already what anything fixed inside it is placed by, so this can't move
        // anything for the moment it's on.)
        const style = getComputedStyle(glass);
        if (glass.style.transform || (style.position !== "fixed" && style.position !== "sticky")) return;
        const blur = style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter");
        if (!blur || blur === "none") return;
        glass.style.transform = "translateZ(0)";
        requestAnimationFrame(() => {
          glass.style.transform = "";
        });
      });
    }, ms),
  );
}

// Every box, the same: where it goes for the keyboard. A notes box or a box on a page to the middle of what's visible; a box in a
// pop-up the same, by what scrolls in the pop-up; a box in a bar held over the page, which can't scroll, with the bar moved up.
function placeFocusedField(): void {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement)) return;
  if (focusedKeyboardCenterBox()) centerFocusedNotesBox();
  else if (field.closest(".glass-modal-panel")) {
    giveFocusedPanelScrollRoom();
    revealFocusedFieldInPanel();
  }
  keepCaretClear(field);
  // Whatever's been tried, if it's still going to be covered (a bar or popover that can't scroll, or a scroller too short to bring
  // it up), what's holding it over the page moves up.
  const vv = window.visualViewport;
  if (!vv || !isPhoneWidth() || !expectsKeyboard(field) || field.isContentEditable) return;
  const host = field.closest<HTMLElement>(".glass-modal-panel") ?? pinnedHostOf(field) ?? fixedHostOf(field);
  if (host) liftPanelToField(field, host, vv);
}

function fixedHostOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    if (getComputedStyle(node).position === "fixed") return node;
  }
  return null;
}

function isPhoneWidth(): boolean {
  return window.matchMedia("(max-width: 639.98px)").matches;
}

// Room at the end of a scroll area (its ::after) — only where that's what it gives (not a box that would just grow
// taller, nor one using its ::after for something else).
function addKeyboardRoom(node: HTMLElement, style: CSSStyleDeclaration, px: number): void {
  const had = node.hasAttribute(KEYBOARD_ROOM_ATTR);
  if (!had) {
    if (style.display.includes("grid")) return;
    const after = getComputedStyle(node, "::after").content;
    if (after !== "none" && after !== "normal") return;
  }
  const previous = node.style.getPropertyValue(KEYBOARD_ROOM_VAR);
  const heightBefore = node.clientHeight;
  node.style.setProperty(KEYBOARD_ROOM_VAR, `${Math.ceil((parseFloat(previous) || 0) + px)}px`);
  node.setAttribute(KEYBOARD_ROOM_ATTR, "true");
  if (node.clientHeight > heightBefore + 0.5) {
    // (It grew instead: not a scroll area of a set height.)
    if (previous) node.style.setProperty(KEYBOARD_ROOM_VAR, previous);
    else {
      node.style.removeProperty(KEYBOARD_ROOM_VAR);
      node.removeAttribute(KEYBOARD_ROOM_ATTR);
    }
  }
}

function clearKeyboardRoom(): void {
  document.querySelectorAll<HTMLElement>(`[${KEYBOARD_ROOM_ATTR}]`).forEach((node) => {
    node.removeAttribute(KEYBOARD_ROOM_ATTR);
    node.style.removeProperty(KEYBOARD_ROOM_VAR);
  });
}

function centerFocusedNotesBox(): void {
  const box = focusedKeyboardCenterBox();
  const vv = window.visualViewport;
  if (!box || !vv) return;
  const visibleTop = vv.offsetTop;
  const active = document.activeElement;
  const visibleBottom = active instanceof HTMLElement ? visibleBottomFor(active, vv) : vv.offsetTop + vv.height;
  // Each scroll area it's in, innermost first — not the document itself (on a phone the page scrolls in <main>; moving
  // the document as well just shifts everything, fixed bars and all, out from under the visible area).
  const areas: HTMLElement[] = [];
  for (let node = box.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") areas.push(node);
  }
  for (const area of areas) {
    const style = getComputedStyle(area);
    const areaBox = area.getBoundingClientRect();
    // Under whatever's stuck over its top (its title bars).
    let coveredTo = areaBox.top;
    area.querySelectorAll<HTMLElement>("[data-title-bar-stuck]").forEach((bar) => {
      const barStyle = getComputedStyle(bar);
      if (barStyle.position === "sticky") coveredTo = Math.max(coveredTo, areaBox.top + (parseFloat(barStyle.top) || 0) + bar.offsetHeight);
    });
    const top = Math.max(coveredTo, visibleTop) + CENTER_MARGIN_PX;
    const bottom = Math.min(areaBox.bottom, visibleBottom) - CENTER_MARGIN_PX;
    if (bottom - top < 40) continue;
    const rect = box.getBoundingClientRect();
    const target = rect.height <= bottom - top ? top + (bottom - top - rect.height) / 2 : top;
    const delta = rect.top - target;
    if (Math.abs(delta) < 1) continue;
    // (Measured again after adding it: what's in a scroll area can reach past the end of its flow, which room after
    // the flow only adds to once past that — topped up till there's enough, a few tries at most.)
    for (let tries = 0; delta > 0 && tries < 3; tries += 1) {
      const short = area.scrollTop + delta - (area.scrollHeight - area.clientHeight);
      if (short <= 0.5) break;
      const roomBefore = area.style.getPropertyValue(KEYBOARD_ROOM_VAR);
      addKeyboardRoom(area, style, short);
      if (area.style.getPropertyValue(KEYBOARD_ROOM_VAR) === roomBefore) break;
    }
    area.scrollTop += delta;
  }
}

// A notes box just tapped: brought to the middle again a few times as things settle — while it's still the one being
// typed in, and the keyboard's up or the box isn't all in view. A phone can still be moving what's visible for a moment
// after the keyboard's come up (iOS revealing the field its own way, after the box was centred), and one that shrinks
// the page itself for the keyboard never reports it as up at all.
const SETTLE_CHECKS_MS = [180, 450, 900, 1400];
const REREAD_AFTER_HOLD_MS = [0, 60, 160, 320, 640];
const FIELD_WATCH_MS = 3500;
const FIELD_WATCH_EVERY_MS = 150;
const FOCUS_OUT_WAIT_MS = 150;
const CARET_LINE_MOST_PX = 60;
const HEADER_REFRESH_MS = [0, 200, 600];
const TAP_MOVE_PX = 10;
const TAP_MOST_MS = 500;

function notesBoxOutOfView(box: HTMLElement): boolean {
  const vv = window.visualViewport;
  if (!vv) return false;
  const rect = box.getBoundingClientRect();
  return rect.top < vv.offsetTop || rect.bottom > vv.offsetTop + vv.height;
}

// A phone slides the whole screen up to show the box tapped. That lifts the page's bottom edge off the bottom of the screen, so
// what's behind the see-through keyboard is the plain background, not the page. So it's put straight back, with everything still
// reaching the bottom of the screen and running under the keyboard, and the box is brought into view by scrolling what it's in
// (centerFocusedNotesBox, revealFocusedFieldInPanel). Not for a box in a bar pinned over the page: scrolling can't move that, so
// the phone's slide is the only way it can be seen. true: it was put back.
let lastScreenHoldMs = 0;
// (Not again straight away: if the phone won't have it, what's shown follows where the phone's put things instead.)
const SCREEN_HOLD_GAP_MS = 800;

function holdScreenStillForKeyboard(): boolean {
  if (Date.now() - lastScreenHoldMs < SCREEN_HOLD_GAP_MS) return false;
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || !isTextEntry(field) || !window.matchMedia("(pointer: coarse)").matches) return false;
  if (!field.closest(".glass-modal-panel") && !standInBoxes.has(field) && !inPinnedBar(field) && !hasOwnScrollArea(field)) return false;
  lastScreenHoldMs = Date.now();
  window.scrollTo(0, 0);
  return true;
}

// Whether what's being typed in is in a pop-up that stays the whole screen on a phone with the keyboard up
// (data-phone-fullscreen — see app/globals.css): it moves with the visible area rather than being capped to it, so its
// field needs bringing into view whenever that moves, or another field is tapped.
function focusInPhoneFullscreenPanel(): boolean {
  const field = document.activeElement;
  return (
    field instanceof HTMLElement &&
    Boolean(field.closest(".glass-modal-panel")) &&
    (Boolean(field.closest(BEHIND_KEYBOARD_PANEL)) || isPhoneFullscreenPanel(field)) &&
    window.matchMedia("(max-width: 639.98px)").matches
  );
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
    let settleTimers: number[] = [];
    const settleNotesBox = () => {
      settleTimers.forEach((timer) => window.clearTimeout(timer));
      const box = focusedKeyboardCenterBox();
      const field = document.activeElement;
      // A field in a phone's pop-up, the same: a phone can still be moving things for a moment after the keyboard's up,
      // and left where that puts it, the field can end up off the screen.
      settleTimers = box
        ? SETTLE_CHECKS_MS.map((ms) =>
            window.setTimeout(() => {
              if (focusedKeyboardCenterBox() !== box) return;
              if (last?.keyboardOpen || notesBoxOutOfView(box)) centerFocusedNotesBox();
            }, ms),
          )
        : focusInPhoneFullscreenPanel()
          ? SETTLE_CHECKS_MS.map((ms) =>
              window.setTimeout(() => {
                schedule();
                if (document.activeElement !== field || !last?.keyboardOpen) return;
                giveFocusedPanelScrollRoom();
                revealFocusedFieldInPanel();
              }, ms),
            )
          : [];
    };
    const publish = () => {
      frame = null;
      // Pinch-zoom also shrinks the visual viewport, but at a scale above 1 — that isn't the keyboard.
      const keyboardOpen = vv.scale <= 1.01 && window.innerHeight - vv.height > KEYBOARD_OPEN_MIN_PX;
      if (keyboardOpen && vv.offsetTop > 0 && holdScreenStillForKeyboard()) {
        giveFocusedPanelScrollRoom();
        // Looked at again a few times: a phone doesn't always say it's moved back, and what's on screen would stay placed for
        // where it was (a pop-up pushed down behind the keyboard) until something else made it say so, like touching the screen.
        REREAD_AFTER_HOLD_MS.forEach((ms) =>
          window.setTimeout(() => {
            schedule();
            placeFocusedField();
          }, ms),
        );
      }
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
      // (And, for a phone's full-screen pop-up, where the visible area starts: it moves with that, and its field too.)
      const keyboardCameOrResized = next.keyboardOpen && (!last?.keyboardOpen || last.visibleHeightPx !== next.visibleHeightPx);
      const keyboardWent = !next.keyboardOpen && Boolean(last?.keyboardOpen);
      const panelCapChanged =
        next.keyboardOpen &&
        (!last?.keyboardOpen ||
          last.visibleHeightPx !== next.visibleHeightPx ||
          (last.offsetTopPx !== next.offsetTopPx && focusInPhoneFullscreenPanel()));
      last = next;
      showKeyboardReadout(vv);
      root.style.setProperty("--keyboard-inset-px", `${next.insetPx}px`);
      root.style.setProperty("--keyboard-offset-top-px", `${next.offsetTopPx}px`);
      if (next.keyboardOpen) {
        root.style.setProperty("--visual-viewport-height-px", `${next.visibleHeightPx}px`);
        root.setAttribute(KEYBOARD_OPEN_ATTR, "true");
      } else {
        root.removeAttribute(KEYBOARD_OPEN_ATTR);
      }
      // A notes box: to the middle (as the keyboard comes up or changes size — not as the visible area's moved about,
      // which is the person scrolling). Anything else in a pop-up: just into view.
      if (keyboardWent) {
        clearKeyboardRoom();
        clearPanelScrollRoom();
        clearPanelLifts();
        refreshHeadersAfterKeyboard();
      }
      if (next.keyboardOpen) giveFocusedPanelScrollRoom();
      if (keyboardCameOrResized && focusedKeyboardCenterBox()) {
        centerFocusedNotesBox();
        settleNotesBox();
      } else if (panelCapChanged && !focusedKeyboardCenterBox()) {
        revealFocusedFieldInPanel();
        if (keyboardCameOrResized) settleNotesBox();
      }
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(publish);
    };
    // Another field tapped in a phone's full-screen pop-up, or into a notes box, while the keyboard's up (no viewport
    // change to go on): into view — a notes box to the middle — once it has the focus.
    let revealFrame: number | null = null;
    let watchTimer: number | null = null;
    let watchUntil = 0;
    const stopWatch = () => {
      if (watchTimer !== null) window.clearInterval(watchTimer);
      watchTimer = null;
    };
    // A box tapped in a phone's pop-up: for the next few seconds it's kept above the keyboard, read afresh each time, until they
    // touch the screen to do something else. A phone can move things late, or not say that it has.
    const watchFocusedField = () => {
      watchUntil = Date.now() + FIELD_WATCH_MS;
      watchTicks = 0;
      if (watchTimer !== null) return;
      watchTimer = window.setInterval(() => {
        const field = document.activeElement;
        if (Date.now() > watchUntil || !(field instanceof HTMLElement) || !expectsKeyboard(field)) {
          stopWatch();
          return;
        }
        schedule();
        showKeyboardReadout(vv);
        watchTicks += 1;
        placeFocusedField();
      }, FIELD_WATCH_EVERY_MS);
    };
    const onFocusIn = () => {
      clearPanelLifts();
      // In the same moment it has the focus, whether it was tapped or a pop-up's just opened with it selected: already clear of the
      // keyboard by the time the phone looks.
      const tapped = document.activeElement;
      if (isPhoneWidth() && tapped instanceof HTMLElement && expectsKeyboard(tapped)) {
        placeFocusedField();
        watchFocusedField();
      }
      // (A notes box: checked on again as the keyboard comes up and things settle, whether it's reported up yet or not.)
      if (focusedKeyboardCenterBox() || focusInPhoneFullscreenPanel()) settleNotesBox();
      if (!last?.keyboardOpen || revealFrame !== null) return;
      if (!focusedKeyboardCenterBox() && !focusInPhoneFullscreenPanel()) return;
      giveFocusedPanelScrollRoom();
      revealFrame = requestAnimationFrame(() => {
        revealFrame = null;
        placeFocusedField();
      });
    };
    // Finished typing in a pop-up. (With the keyboard reported as up, it's taken away as that goes.)
    const onFocusOut = (event: FocusEvent) => {
      // (What lost the focus: only a box that brings up an on-screen keyboard can have taken one away.)
      const left = event.target;
      window.setTimeout(() => {
        const field = document.activeElement;
        showKeyboardReadout(vv);
        if (field instanceof HTMLElement && expectsKeyboard(field)) return;
        stopWatch();
        if (last?.keyboardOpen) {
          // Its box gone but the keyboard still reported as up: the phone hasn't said it's closed, so the headers are redrawn
          // from here. (When it has said so, `publish` has redrawn them already.) Only for a box that brings a keyboard up:
          // the redraw tells the page the window's resized, which also closes any menu that's open. Any other focus change,
          // such as the right-click that opens a menu, mustn't set it off.
          if (left instanceof HTMLElement && expectsKeyboard(left)) refreshHeadersAfterKeyboard();
          return;
        }
        clearKeyboardRoom();
        clearPanelScrollRoom();
        clearPanelLifts();
      }, FOCUS_OUT_WAIT_MS);
    };
    // Typing: a box growing stays placed, and the cursor stays above the keyboard.
    let typedField: HTMLElement | null = null;
    let typedHeight = 0;
    const onTyped = () => {
      requestAnimationFrame(() => {
        const field = document.activeElement;
        if (!(field instanceof HTMLElement) || !isPhoneWidth() || !expectsKeyboard(field)) return;
        const height = field.getBoundingClientRect().height;
        const grew = typedField === field && Math.abs(height - typedHeight) > 1;
        typedField = field;
        typedHeight = height;
        if (grew || typingOutOfSight(field, vv)) placeFocusedField();
        else keepCaretClear(field);
      });
    };
    // About to type in a box they've dragged away from: back to it before the letter goes in, so the phone doesn't slide the screen
    // up to show it first.
    const onAboutToType = () => {
      const field = document.activeElement;
      if (field instanceof HTMLElement && isPhoneWidth() && expectsKeyboard(field) && typingOutOfSight(field, vv)) placeFocusedField();
    };
    // A box tapped where the keyboard's about to cover it. Left to itself a phone slides the whole screen up to show it, and past
    // the page's bottom edge nothing's drawn, so a plain colour shows behind the see-through keyboard instead of what's on the
    // page. So the tap's taken over: the box gets the focus and is moved up in the same moment, before the phone looks, and with it
    // already clear of the keyboard the phone has no reason to slide anything. (The cursor goes to the end of what's in it; another
    // tap, in a box that already has the focus, places it as usual.)
    let tap: { field: HTMLElement; x: number; y: number; at: number } | null = null;
    const onTapStart = (event: TouchEvent) => {
      tap = null;
      if (event.touches.length !== 1 || !(event.target instanceof Element)) return;
      const field = event.target.closest<HTMLElement>('input, textarea, [contenteditable="true"]');
      if (!field) return;
      const touch = event.touches[0];
      tap = { field, x: touch.clientX, y: touch.clientY, at: Date.now() };
    };
    const onTapMove = (event: TouchEvent) => {
      if (!tap) return;
      const touch = event.touches[0];
      if (Math.abs(touch.clientX - tap.x) > TAP_MOVE_PX || Math.abs(touch.clientY - tap.y) > TAP_MOVE_PX) tap = null;
    };
    const onTapEnd = (event: TouchEvent) => {
      const current = tap;
      tap = null;
      if (!current || !event.cancelable || Date.now() - current.at > TAP_MOST_MS) return;
      const { field } = current;
      const control = field as HTMLInputElement | HTMLTextAreaElement;
      if (document.activeElement === field || control.disabled || control.readOnly || !field.isConnected) return;
      if (!expectsKeyboard(field) || !isPhoneWidth()) return;
      if (!field.closest(".glass-modal-panel") && !inPinnedBar(field) && !hasOwnScrollArea(field)) return;
      const touch = event.changedTouches[0];
      const topBefore = field.getBoundingClientRect().top;
      // (An editor: only where the tap was is low down, not the whole of it.)
      const lowDown = field.isContentEditable ? touch.clientY + REVEAL_MARGIN_PX : field.getBoundingClientRect().bottom + REVEAL_MARGIN_PX;
      if (lowDown <= visibleBottomFor(field, vv)) return;
      event.preventDefault();
      const press = (type: string) =>
        field.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: touch.clientX, clientY: touch.clientY }));
      // (Something can ask, on being pressed, not to take the focus. That still stands.)
      if (!press("mousedown")) {
        press("mouseup");
        press("click");
        return;
      }
      field.focus({ preventScroll: true });
      if (document.activeElement !== field) {
        press("mouseup");
        press("click");
        return;
      }
      placeFocusedField();
      if (field.isContentEditable) {
        // The cursor where they tapped, wherever that's moved to.
        const moved = field.getBoundingClientRect().top - topBefore;
        const range = document.caretRangeFromPoint?.(touch.clientX, touch.clientY + moved);
        const selection = window.getSelection();
        if (range && selection && field.contains(range.startContainer)) {
          selection.removeAllRanges();
          selection.addRange(range);
          keepCaretClear(field);
        }
      }
      press("mouseup");
      press("click");
    };
    // The page itself resized while a notes box is being typed in — a phone that shrinks it for the keyboard rather than
    // covering it: checked on as above.
    const onWindowResize = () => {
      if (focusedKeyboardCenterBox()) settleNotesBox();
    };
    publish();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("input", onTyped);
    document.addEventListener("beforeinput", onAboutToType);
    document.addEventListener("touchstart", onTapStart, { passive: true, capture: true });
    document.addEventListener("touchmove", onTapMove, { passive: true, capture: true });
    document.addEventListener("touchend", onTapEnd, { passive: false, capture: true });
    document.addEventListener("touchmove", stopWatch, { passive: true, capture: true });
    window.addEventListener("resize", onWindowResize);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("input", onTyped);
      document.removeEventListener("beforeinput", onAboutToType);
      document.removeEventListener("touchstart", onTapStart, { capture: true });
      document.removeEventListener("touchmove", onTapMove, { capture: true });
      document.removeEventListener("touchend", onTapEnd, { capture: true });
      document.removeEventListener("touchmove", stopWatch, { capture: true });
      stopWatch();
      keyboardReadout?.remove();
      keyboardReadout = null;
      window.removeEventListener("resize", onWindowResize);
      if (frame !== null) cancelAnimationFrame(frame);
      if (revealFrame !== null) cancelAnimationFrame(revealFrame);
      settleTimers.forEach((timer) => window.clearTimeout(timer));
      root.removeAttribute(KEYBOARD_OPEN_ATTR);
      clearKeyboardRoom();
      clearPanelScrollRoom();
      clearPanelLifts();
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
