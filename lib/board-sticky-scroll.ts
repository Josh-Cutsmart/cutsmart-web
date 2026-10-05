"use client";

import { useCallback, useRef, type MutableRefObject, type RefObject } from "react";
import { attachBoardArrowKeyScroll } from "@/lib/board-arrow-key-scroll";

// Shared sticky-board scroll handling for a kanban column panel (used by the Dashboard board/
// sub-board and the Leads board — same `position: sticky` panel + `[data-board-column]` children
// convention).
//
// This used to also force `overflow-y: hidden` on the page once a board was "nearly locked," with
// the only release path wired to the `wheel` event (manually driving `scrollTop` while briefly
// lifting the block). That's deleted entirely: `position: sticky` already does everything needed
// natively — it stops the panel scrolling past its stuck offset, and native CSS scroll-chaining
// already hands a continued gesture (wheel, trackpad, touch, keyboard, scrollbar-drag — all of
// them, not just wheel) back to the page once a column's card list hits its own scroll boundary,
// the same way any ordinary nested scrollable does. The old page-scroll-blocked layer was fighting
// that native behavior instead of relying on it: its only un-stick path (a `wheel` listener) never
// fired for touch/keyboard/scrollbar-drag, so the page could get permanently stuck unable to
// scroll back up; and its manual `scrollTop +=` per tick, instead of the browser's own momentum
// scroll, is why un-sticking felt like a discrete jump rather than a smooth scroll. Removing it
// fixes both.
//
// What's left: each column's card list still needs to switch from `overflow-y: hidden` to `auto`
// at the right moment — not always-on, or a swipe over a not-yet-stuck column would scroll the
// cards instead of finishing the page scroll that brings the board into its stuck position — and
// the column height-reveal animation (a column grows into view as it scrolls up under the sticky
// panel).
export function useBoardStickyRef(
  viewModeRef: RefObject<string>,
  checkRef: MutableRefObject<(() => void) | null>,
  opts?: { bottomPadPx?: number; attachArrowKeyScroll?: boolean },
): (el: HTMLDivElement | null) => void {
  const bottomPadPx = opts?.bottomPadPx ?? 10;
  const shouldAttachArrowKeyScroll = opts?.attachArrowKeyScroll ?? false;
  const cleanupRef = useRef<(() => void) | null>(null);

  return useCallback(
    (el: HTMLDivElement | null) => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      checkRef.current = null;
      if (!el) return;
      let raf = 0;
      const mainEl = document.querySelector("main");
      // Each column's card list toggles overflow-y/touchAction directly on the DOM (not via React
      // state) for the same reason height is written directly below: going through setState here
      // would add a render cycle between "scroll crossed the threshold" and "the column can
      // actually be scrolled", long enough to eat the rest of a trackpad gesture. A plain style
      // write lands on the very next paint.
      //
      // Only written when it flips (it used to be rewritten on every list, every scroll frame);
      // listsScrollable is reset to null whenever the board's contents change, so freshly rendered
      // lists get it too.
      let listsScrollable: boolean | null = null;
      const setCardListsScrollable = (scrollable: boolean) => {
        if (listsScrollable === scrollable) return;
        listsScrollable = scrollable;
        el.querySelectorAll<HTMLElement>(".glass-scroll.flex-1").forEach((list) => {
          list.style.overflowY = scrollable ? "auto" : "hidden";
          // touch-action stays at the browser default in both states. It used to flip to "pan-y"
          // once the list became the vertical scroller, but touch-action doesn't hand the other
          // axis off to an ancestor — it forbids it for any touch that starts inside the element —
          // so once the board locked into its full-screen position a sideways swipe over a column's
          // cards couldn't scroll the board between columns at all. With the default, the browser
          // routes each gesture by its own direction: vertical scrolls this list, horizontal chains
          // to the board's horizontal scroller.
          list.style.touchAction = "";
        });
      };
      // Each column is two nested elements: an outer shell (marked `data-board-column`) that owns
      // the box-shadow and layout sizing, and an inner element that owns the background/border/
      // blur and rounded/overflow-hidden. The reveal below sets the OUTER's real `height` directly
      // rather than clip-path-ing anything — that's what keeps the shadow (which always renders
      // around whatever size the outer currently is) and the rounded bottom (the inner's own
      // border-radius, which rounds correctly at any height) continuously in sync with how much of
      // the column is actually revealed. Safe to do with a real height (unlike the row/panel
      // itself) because a column's own height doesn't feed into the row's — the row's is fixed
      // independently, so shrinking a column here never changes the page's total scrollable
      // height.
      const getColumns = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>("[data-board-column]"));
      let cachedFullHeight = 0;
      let cachedFullHeightKey = "";
      // The panel's sticky offset and whether <main> is the scroller only change with the layout (a
      // resize, or the board's contents changing) — read once then, not on every scroll frame (each
      // is a computed-style read). See check() for what they mean.
      let layout: { stuckTop: number; mainScrolls: boolean } | null = null;
      const readLayout = () => {
        if (!layout) {
          layout = {
            stuckTop: Number.parseFloat(getComputedStyle(el).top) || 0,
            mainScrolls: Boolean(mainEl) && getComputedStyle(mainEl as HTMLElement).overflowY !== "visible",
          };
        }
        return layout;
      };
      const check = () => {
        raf = 0;
        // Each column's card list has a fixed, viewport-relative height from the moment it
        // renders — position:sticky only changes whether the panel tracks scroll or holds still,
        // not its size — so if the card list were always overflow-y-auto, a swipe over an
        // unlocked (not-yet-stuck) column would scroll the cards instead of the page. Keep it
        // non-scrollable until the sticky panel has actually reached its stuck offset, so the
        // gesture bubbles up to the page/main scroll and finishes bringing the board to the top.
        if (viewModeRef.current !== "board") {
          setCardListsScrollable(false);
          getColumns().forEach((col) => { col.style.height = ""; });
          cachedFullHeightKey = "";
          return;
        }
        // getBoundingClientRect() is always viewport-relative, but the sticky `top` offset is
        // relative to whichever element is actually scrolling — on mobile that's `<main>` itself
        // (already offset ~48px below the fixed tab bar), on desktop it's the document (offset 0).
        // Comparing rect.top straight to the CSS top value only works for the latter, so add back
        // the scrollport's own offset when main is the one doing the scrolling.
        const { stuckTop, mainScrolls } = readLayout();
        const containerTop = mainScrolls ? (mainEl as HTMLElement).getBoundingClientRect().top : 0;
        const rect = el.getBoundingClientRect();
        // A discrete wheel/trackpad tick resolves its scroll target ONCE, based on what's
        // scrollable at that instant — so if a card list only becomes overflow-y-auto exactly AT
        // the pixel the panel finishes locking, the tick that lands the panel there still scrolls
        // the page, and the user needs one more, separate tick before the column responds.
        // Unlocking a few pixels EARLY (while the panel's own scroll-into-place is still
        // finishing) means the card list is already scrollable by the time that happens, so the
        // same continuous gesture carries straight through. Small on purpose: position:sticky
        // itself still won't let the panel move past its stuck offset regardless, so this can't
        // reintroduce cards swallowing a swipe well before the panel has scrolled into place — it
        // only shaves the last few pixels of an already-almost-finished scroll.
        const EARLY_SCROLLABLE_PX = 24;
        const nearlyLocked = rect.top <= containerTop + stuckTop + EARLY_SCROLLABLE_PX;
        setCardListsScrollable(nearlyLocked);
        const columns = getColumns();
        const firstCol = columns[0];
        if (!firstCol) return;
        // The column's natural (fully-grown) height doesn't change from one scroll frame to the
        // next — only how much of it is currently revealed does — so it's cached here instead of
        // being remeasured on every single scroll-driven call. Remeasuring meant resetting height
        // to "" and immediately reading getBoundingClientRect(), a write-then-read that forces a
        // synchronous layout reflow; doing that (plus repainting every column's backdrop-filter
        // blur) on every scroll frame for the whole lock-in transition is what showed up as
        // stutter, especially visible right at the moving bottom edge, worse on mobile GPUs. The
        // cache key covers the two things that actually DO change it: the column count (data
        // load/filter swapping which columns exist) and the viewport size (resize/orientation).
        const fullHeightCacheKey = `${columns.length}:${window.innerWidth}x${window.innerHeight}`;
        if (fullHeightCacheKey !== cachedFullHeightKey) {
          const prevHeight = firstCol.style.height;
          firstCol.style.height = "";
          cachedFullHeight = firstCol.getBoundingClientRect().height;
          firstCol.style.height = prevHeight;
          cachedFullHeightKey = fullHeightCacheKey;
        }
        const colRect = firstCol.getBoundingClientRect();
        // bottomPadPx gives the revealed edge breathing room from the viewport bottom, matching
        // the surrounding padding so every side of a column has the same gap instead of running
        // flush to the screen edge. It stays in the formula even once locked — rect.top then holds
        // steady at the sticky offset, so this settles just short of the column's true height
        // rather than snapping straight to it, avoiding a jump at the handoff. Measured off each
        // column's own rect (not the wrapper's) so this stays correct regardless of any padding
        // between the wrapper and the columns.
        const grownHeight = Math.min(cachedFullHeight, Math.max(0, window.innerHeight - bottomPadPx - colRect.top));
        const nextHeight = grownHeight < cachedFullHeight - 0.5 ? `${grownHeight}px` : "";
        columns.forEach((col) => {
          if (col.style.height !== nextHeight) col.style.height = nextHeight;
        });
      };
      checkRef.current = check;
      const onScroll = () => {
        if (raf) return;
        raf = window.requestAnimationFrame(check);
      };
      const onResize = () => {
        layout = null;
        onScroll();
      };
      check();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onResize);
      mainEl?.addEventListener("scroll", onScroll, { passive: true });
      // Columns load asynchronously, so the very first `check()` call above can land before any
      // column has actually rendered — `getColumns()` finds nothing yet, so nothing gets sized,
      // and nothing else was going to call `check()` again once the columns actually mounted (the
      // view-mode re-check effect elsewhere only reruns on the view mode itself, which by then has
      // already settled). Watching `el` for child changes catches that moment generically — real
      // data finishing load, a filter/search change swapping which columns exist, anything —
      // without needing to name every state that could cause it. Calls `check()` directly rather
      // than going through the rAF-throttled `onScroll`: that throttle exists to coalesce
      // rapid-fire scroll events, but mutations here are infrequent, and a backgrounded tab can
      // leave a pending rAF callback waiting on the browser (which pauses rAF, not
      // MutationObserver, for hidden tabs) — no reason to route through it.
      const observer = new MutationObserver(() => {
        layout = null;
        listsScrollable = null;
        check();
      });
      observer.observe(el, { childList: true, subtree: true });
      const detachArrowKeyScroll = shouldAttachArrowKeyScroll ? attachBoardArrowKeyScroll(el) : null;
      cleanupRef.current = () => {
        if (raf) window.cancelAnimationFrame(raf);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
        mainEl?.removeEventListener("scroll", onScroll);
        observer.disconnect();
        detachArrowKeyScroll?.();
        getColumns().forEach((col) => { col.style.height = ""; });
        listsScrollable = null;
        setCardListsScrollable(false);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
