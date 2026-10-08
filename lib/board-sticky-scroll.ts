"use client";

import { useCallback, useRef, type MutableRefObject, type RefObject } from "react";
import { attachBoardArrowKeyScroll } from "@/lib/board-arrow-key-scroll";

// Shared sticky-board scroll handling for a kanban column panel (used by the Dashboard board/
// sub-board and the Leads board — same `position: sticky` panel + `[data-board-column]` children
// convention, each column drawn by components/board-column-frame.tsx).
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
// the columns' reveal: while the board scrolls up into place, each column's bottom edge stays on the
// bottom of the screen (bottomPadPx above it), the column showing more of itself as it rises.
//
// The reveal never resizes anything. A column's frame (board-column-frame.tsx) is cut off at the
// bottom by a window that's moved up by however much of the column is past that line — the "shift" —
// with the column itself moved back down by the same amount. Where the browser can (ScrollTimeline:
// Chrome, Edge, Safari), those two moves are animations tied to the page's scroll position, which the
// browser applies in the same step as the scroll itself, so the edge holds perfectly still; this
// script only works out the numbers, and only redoes them when the layout changes. It used to set
// every column's height from a scroll listener instead, which always landed a frame behind the scroll
// (and re-laid-out every column, every frame) — the edge visibly wobbled. Elsewhere the moves are
// still set from the scroll listener, but they're only transforms now (no layout).

// The least of a column ever shown at that edge: its rounded corners (see .board-column-window).
const REVEAL_MIN_PX = 16;

type ScrollTimelineConstructor = new (options: { source: Element; axis?: "block" | "inline" }) => AnimationTimeline;

function getScrollTimelineConstructor(): ScrollTimelineConstructor | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ScrollTimeline?: ScrollTimelineConstructor }).ScrollTimeline ?? null;
}

export function useBoardStickyRef(
  viewModeRef: RefObject<string>,
  checkRef: MutableRefObject<(() => void) | null>,
  // bottomPadPx: the gap left under the columns while they grow into view — the same as the board's own
  // bottom padding (the gap once it's stuck), so it's the same all the way. phoneBottomPadPx: the same on a
  // phone (under 768px), if different.
  opts?: { bottomPadPx?: number; phoneBottomPadPx?: number; attachArrowKeyScroll?: boolean },
): (el: HTMLDivElement | null) => void {
  const desktopBottomPadPx = opts?.bottomPadPx ?? 10;
  const phoneBottomPadPx = opts?.phoneBottomPadPx ?? desktopBottomPadPx;
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
      const phoneQuery = window.matchMedia("(max-width: 767px)");
      const ScrollTimelineCtor = getScrollTimelineConstructor();
      // Each column's card list toggles overflow-y/touchAction directly on the DOM (not via React
      // state): going through setState here would add a render cycle between "scroll crossed the
      // threshold" and "the column can actually be scrolled", long enough to eat the rest of a
      // trackpad gesture. A plain style write lands on the very next paint.
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
      const getColumns = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>("[data-board-column]"));
      const getMoved = (col: HTMLElement) => ({
        lift: col.querySelector<HTMLElement>("[data-board-column-lift]"),
        drop: col.querySelector<HTMLElement>("[data-board-column-drop]"),
      });

      // --- Applying the shift
      // Scroll-linked: each column's two moves as animations on the page's scroll timeline, from
      // keyframes over the whole scroll range. Recreated only when those keyframes change (the
      // key), or for columns that weren't there before.
      const columnAnimations = new WeakMap<HTMLElement, { key: string; animations: Animation[] }>();
      const animatedColumns = new Set<HTMLElement>();
      const stopAnimations = (col: HTMLElement) => {
        columnAnimations.get(col)?.animations.forEach((animation) => animation.cancel());
        columnAnimations.delete(col);
        animatedColumns.delete(col);
      };
      // Set straight from script: the fallback, and a page that can't scroll at all.
      const staticShift = new WeakMap<HTMLElement, number>();
      const setStaticShift = (col: HTMLElement, shift: number) => {
        if (columnAnimations.has(col)) stopAnimations(col);
        if (staticShift.get(col) === shift) return;
        staticShift.set(col, shift);
        const { lift, drop } = getMoved(col);
        if (lift) lift.style.transform = shift ? `translate3d(0, ${-shift}px, 0)` : "";
        if (drop) drop.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : "";
      };
      // The page's scroll timeline; id goes into the keyframes' key, so a new one (the page scrolling
      // with a different element after a resize) means new animations.
      let timeline: { source: Element; timeline: AnimationTimeline; id: number } | null = null;
      const getTimeline = (source: Element) => {
        if (!ScrollTimelineCtor) return null;
        if (!timeline || timeline.source !== source) {
          timeline = { source, timeline: new ScrollTimelineCtor({ source, axis: "block" }), id: (timeline?.id ?? 0) + 1 };
        }
        return timeline;
      };
      const setScrollLinkedShift = (
        col: HTMLElement,
        frames: { offset: number; shift: number }[],
        key: string,
        scrollTimeline: AnimationTimeline,
      ) => {
        if (columnAnimations.get(col)?.key === key) return;
        stopAnimations(col);
        if (staticShift.has(col)) {
          staticShift.delete(col);
          const { lift, drop } = getMoved(col);
          if (lift) lift.style.transform = "";
          if (drop) drop.style.transform = "";
        }
        const { lift, drop } = getMoved(col);
        const animations: Animation[] = [];
        const options: KeyframeAnimationOptions = { timeline: scrollTimeline, fill: "both", easing: "linear" };
        if (lift) {
          animations.push(lift.animate(frames.map((f) => ({ offset: f.offset, transform: `translate3d(0, ${-f.shift}px, 0)` })), options));
        }
        if (drop) {
          animations.push(drop.animate(frames.map((f) => ({ offset: f.offset, transform: `translate3d(0, ${f.shift}px, 0)` })), options));
        }
        columnAnimations.set(col, { key, animations });
        animatedColumns.add(col);
      };
      const resetShifts = () => {
        animatedColumns.forEach((col) => stopAnimations(col));
        getColumns().forEach((col) => setStaticShift(col, 0));
      };

      // --- Where things are
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
      // For the scroll-linked moves: where the columns' tops would be at scroll 0, and the scroll
      // position the panel locks at. Measured while the panel is still moving with the page (once
      // it's stuck its position stops telling either) and kept for while it's stuck.
      let geometry: { colTopAtZero: number; stickAt: number } | null = null;

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
        const lockedTop = containerTop + stuckTop;
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
        setCardListsScrollable(rect.top <= lockedTop + EARLY_SCROLLABLE_PX);

        const columns = getColumns();
        const firstCol = columns[0];
        if (!firstCol) return;
        // The slot is never moved or resized — it's where the whole column is.
        const colRect = firstCol.getBoundingClientRect();
        const fullHeight = colRect.height;
        const bottomPadPx = phoneQuery.matches ? phoneBottomPadPx : desktopBottomPadPx;
        const maxShift = Math.max(0, fullHeight - REVEAL_MIN_PX);

        const scroller = mainScrolls ? (mainEl as HTMLElement) : document.scrollingElement ?? document.documentElement;
        const scrollPos = scroller.scrollTop;
        const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        if (Math.abs(rect.top - lockedTop) > 0.5) {
          geometry = { colTopAtZero: Math.round(colRect.top + scrollPos), stickAt: Math.round(scrollPos + rect.top - lockedTop) };
        } else if (!geometry) {
          // Already stuck with nothing measured yet (e.g. the page came back scrolled down): where it
          // would be if it weren't sticky.
          const previousPosition = el.style.position;
          el.style.position = "static";
          const naturalTop = el.getBoundingClientRect().top;
          const naturalColTop = firstCol.getBoundingClientRect().top;
          el.style.position = previousPosition;
          geometry = { colTopAtZero: Math.round(naturalColTop + scrollPos), stickAt: Math.round(scrollPos + naturalTop - lockedTop) };
        }
        const { colTopAtZero, stickAt } = geometry;
        // The line the columns' bottom edges stay on: bottomPadPx above the bottom of the screen —
        // or, if the board actually finishes a little higher once scrolled all the way (its own
        // bottom border, the page's height being rounded to a whole pixel), there, so the edge has
        // nowhere left to move at the very end. (It used to be carried up the last pixel or two.)
        const finalBottom = colTopAtZero - Math.min(maxScroll, stickAt) + fullHeight;
        const screenLine = window.innerHeight - bottomPadPx;
        const edgeY = finalBottom < screenLine && screenLine - finalBottom < 24 ? finalBottom : screenLine;
        const shiftFor = (colTop: number) => Math.min(maxShift, Math.max(0, colTop + fullHeight - edgeY));

        const pageTimeline = maxScroll > 0 ? getTimeline(scroller) : null;
        if (!pageTimeline) {
          // No scroll-linked animations here (or nothing to scroll): set it for where things are now.
          const shift = Math.round(shiftFor(colRect.top) * 2) / 2;
          columns.forEach((col) => setStaticShift(col, shift));
          return;
        }
        // The shift at scroll s. Straight lines between: where the column first shows its last
        // REVEAL_MIN_PX, where it's whole, where the panel locks, and either end.
        const shiftAt = (s: number) => shiftFor(colTopAtZero - Math.min(s, stickAt));
        const wholeAt = colTopAtZero + fullHeight - edgeY;
        const points = [0, maxScroll, wholeAt - maxShift, wholeAt, stickAt]
          .filter((s) => s >= 0 && s <= maxScroll)
          .sort((a, b) => a - b)
          .filter((s, i, all) => i === 0 || s - all[i - 1] > 0.5);
        const frames = points.map((s) => ({ offset: s / maxScroll, shift: Math.round(shiftAt(s) * 2) / 2 }));
        if (frames[frames.length - 1].offset < 1) frames.push({ offset: 1, shift: Math.round(shiftAt(maxScroll) * 2) / 2 });
        const key = `${pageTimeline.id}/${frames.map((f) => `${f.offset.toFixed(5)}:${f.shift}`).join("|")}`;
        columns.forEach((col) => setScrollLinkedShift(col, frames, key, pageTimeline.timeline));
      };
      checkRef.current = check;
      const onScroll = () => {
        if (raf) return;
        raf = window.requestAnimationFrame(check);
      };
      const onResize = () => {
        layout = null;
        geometry = null;
        onScroll();
      };
      check();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onResize);
      mainEl?.addEventListener("scroll", onScroll, { passive: true });
      // Columns load asynchronously, so the very first `check()` call above can land before any
      // column has actually rendered — `getColumns()` finds nothing yet, so nothing gets set up,
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
        geometry = null;
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
        resetShifts();
        listsScrollable = null;
        setCardListsScrollable(false);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
