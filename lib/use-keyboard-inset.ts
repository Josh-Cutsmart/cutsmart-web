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
function revealFocusedFieldInPanel(): void {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || !field.closest(".glass-modal-panel")) return;
  // (Only a full-screen pop-up's scroll area reaches behind the keyboard; a capped one's is all above it already.)
  const vv = window.visualViewport;
  const behindKeyboard = Boolean(field.closest('.glass-modal-panel[data-phone-fullscreen="true"]'));
  const visibleTop = vv && behindKeyboard ? vv.offsetTop : -Infinity;
  const visibleBottom = vv && behindKeyboard ? vv.offsetTop + vv.height : Infinity;
  for (let node = field.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      const box = node.getBoundingClientRect();
      const top = Math.max(box.top, visibleTop);
      const bottom = Math.min(box.bottom, visibleBottom);
      const rect = field.getBoundingClientRect();
      if (rect.bottom > bottom) node.scrollTop += rect.bottom - bottom + REVEAL_MARGIN_PX;
      else if (rect.top < top) node.scrollTop -= top - rect.top + REVEAL_MARGIN_PX;
    }
    if (node.classList.contains("glass-modal-panel")) return;
  }
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

function focusedKeyboardCenterBox(): HTMLElement | null {
  const field = document.activeElement;
  return field instanceof HTMLElement ? field.closest<HTMLElement>("[data-keyboard-center]") : null;
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
  const visibleBottom = vv.offsetTop + vv.height;
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

// Whether what's being typed in is in a pop-up that stays the whole screen on a phone with the keyboard up
// (data-phone-fullscreen — see app/globals.css): it moves with the visible area rather than being capped to it, so its
// field needs bringing into view whenever that moves, or another field is tapped.
function focusInPhoneFullscreenPanel(): boolean {
  const field = document.activeElement;
  return (
    field instanceof HTMLElement &&
    Boolean(field.closest('.glass-modal-panel[data-phone-fullscreen="true"]')) &&
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
      // (And, for a phone's full-screen pop-up, where the visible area starts: it moves with that, and its field too.)
      const keyboardCameOrResized = next.keyboardOpen && (!last?.keyboardOpen || last.visibleHeightPx !== next.visibleHeightPx);
      const keyboardWent = !next.keyboardOpen && Boolean(last?.keyboardOpen);
      const panelCapChanged =
        next.keyboardOpen &&
        (!last?.keyboardOpen ||
          last.visibleHeightPx !== next.visibleHeightPx ||
          (last.offsetTopPx !== next.offsetTopPx && focusInPhoneFullscreenPanel()));
      last = next;
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
      if (keyboardWent) clearKeyboardRoom();
      if (keyboardCameOrResized && focusedKeyboardCenterBox()) centerFocusedNotesBox();
      else if (panelCapChanged && !focusedKeyboardCenterBox()) revealFocusedFieldInPanel();
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(publish);
    };
    // Another field tapped in a phone's full-screen pop-up, or into a notes box, while the keyboard's up (no viewport
    // change to go on): into view — a notes box to the middle — once it has the focus.
    let revealFrame: number | null = null;
    const onFocusIn = () => {
      if (!last?.keyboardOpen || revealFrame !== null) return;
      if (!focusedKeyboardCenterBox() && !focusInPhoneFullscreenPanel()) return;
      revealFrame = requestAnimationFrame(() => {
        revealFrame = null;
        if (focusedKeyboardCenterBox()) centerFocusedNotesBox();
        else revealFocusedFieldInPanel();
      });
    };
    publish();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      document.removeEventListener("focusin", onFocusIn);
      if (frame !== null) cancelAnimationFrame(frame);
      if (revealFrame !== null) cancelAnimationFrame(revealFrame);
      root.removeAttribute(KEYBOARD_OPEN_ATTR);
      clearKeyboardRoom();
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
