"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

// A plain-div replacement for a scroll container's native scrollbar — needed anywhere content is
// meant to scroll under a fixed/sticky glass header (vertical), or where the container's own
// trailing edge (bottom, for horizontal) can end up off-screen so the native scrollbar isn't
// reachable at all. A native scrollbar can't be covered by any amount of z-index/opacity/background
// trickery: it renders in the browser's own compositing layer, which sits above ordinary page
// content regardless of stacking context (confirmed empirically — a fully opaque cover div placed
// directly over one still didn't hide it). A plain div has none of that problem: it's ordinary
// content, so any existing sticky/fixed header with a higher z-index already correctly paints over
// it exactly like it would over anything else, naturally "stopping" the visible thumb right at the
// header's edge (vertical mode).
//
// Usage (vertical, the default): give the scroll container `overflow-y-auto hide-native-scrollbar`,
// then render <GlassScrollbarThumb scrollRef={thatContainersRef} /> anywhere (it portals to
// document.body and measures the container's own on-screen position, so it works whether that
// container is a full-viewport page or a small modal's own scroll box).
//
// Vertical tracks start below whatever fixed/sticky title bars are stacked over the top of the
// container (see titleBarsBottom), so the thumb never runs underneath a title bar. Passing the
// document element (<html>) as scrollRef tracks the page's own scroll against the viewport.
//
// Usage (horizontal): pass orientation="horizontal". Instead of matching the anchor's own top/height
// (vertical mode's behavior, meant to sit flush against a sticky header), the track pins its `top`
// to whichever is smaller — the anchor's own bottom edge, or the viewport's — so the thumb stays
// reachable even when the scroll container's natural bottom edge (where its native scrollbar would
// render) is currently scrolled below the viewport.
// Bars that can sit over the top of a scroll area: the app's tab bar and the fullscreen views' fixed top
// bars (data-app-top-bar / -content), sticky glass title bars (.glass-page-header), or anything marked
// data-title-bar="true".
const TITLE_BAR_SELECTOR = '[data-app-top-bar="true"], [data-app-top-bar-content="true"], .glass-page-header, [data-title-bar="true"]';

// How far down from `top` the stack of title bars over the column [left, right] reaches — where a
// vertical track should start so it never runs underneath them. Bars count when they're chained down
// from `top` (each touching the one above) and are pinned (fixed or sticky) — a header that scrolls
// with the content isn't over the track, and one further down the page doesn't touch the top. A
// header row explicitly marked data-title-bar="true" counts even though it scrolls: it's part of a
// header stack (e.g. project details' Created/Modified row between its sticky name bar and tab bar),
// so the track stays below the whole stack rather than starting in the middle of it.
//
// Finding the bars (a whole-document search plus each one's computed style) is the expensive part, and it
// used to run for every scrollbar on every scroll frame. The list is now shared by all scrollbars and
// rebuilt at most every TITLE_BARS_TTL_MS (or straight away after a resize); each frame only re-reads the
// listed bars' positions, which is cheap.
const TITLE_BARS_TTL_MS = 500;
let titleBarsCache: { at: number; bars: HTMLElement[] } | null = null;

function invalidateTitleBars() {
  titleBarsCache = null;
}

function titleBarCandidates(): HTMLElement[] {
  const now = performance.now();
  if (titleBarsCache && now - titleBarsCache.at < TITLE_BARS_TTL_MS) return titleBarsCache.bars;
  const bars: HTMLElement[] = [];
  document.querySelectorAll<HTMLElement>(TITLE_BAR_SELECTOR).forEach((bar) => {
    const style = getComputedStyle(bar);
    const pinned = style.position === "fixed" || style.position === "sticky";
    if ((!pinned && bar.dataset.titleBar !== "true") || style.visibility === "hidden" || style.display === "none") return;
    bars.push(bar);
  });
  titleBarsCache = { at: now, bars };
  return bars;
}

function titleBarsBottom(top: number, bottom: number, left: number, right: number): number {
  const rects: DOMRect[] = [];
  for (const bar of titleBarCandidates()) {
    if (!bar.isConnected) continue;
    const r = bar.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.right < left || r.left > right) continue;
    rects.push(r);
  }
  rects.sort((a, b) => a.top - b.top);
  let edge = top;
  for (const r of rects) if (r.top <= edge + 1 && r.bottom > edge) edge = r.bottom;
  return Math.min(edge, bottom);
}

// The page's own scrollbar (the document — desktop pages, the client portal), as the same glass thumb,
// starting below the title bars. app/globals.css hides the native one on <html>. Rendered once, in the
// root layout.
export function DocumentScrollbar() {
  const documentRef = useRef<HTMLElement | null>(typeof document !== "undefined" ? document.documentElement : null);
  return <GlassScrollbarThumb scrollRef={documentRef} />;
}

export function GlassScrollbarThumb({
  scrollRef,
  anchorRef,
  refreshKey,
  orientation = "vertical",
  side = "right",
  insetPx = 2,
  zIndexClassName = "z-[80]",
  thumbWidthPx = 6,
  viewportBottomInsetPx = 12,
  trackClassName = "",
}: {
  scrollRef: RefObject<HTMLElement | null>;
  // Element whose bounding box positions the track — defaults to scrollRef's own element. Pass a
  // separate, non-scrolling ancestor when scrollRef itself is one page of a horizontally-paged row
  // (e.g. Nesting/CNC's mobile board-type swiper): the page's own bounding box moves left/right as
  // it scrolls into and out of view, which would otherwise drag the thumb along with the horizontal
  // swipe instead of leaving it parked at a fixed screen position.
  anchorRef?: RefObject<HTMLElement | null>;
  // Include whatever identifies "which element scrollRef.current now points at" (e.g. an active
  // board key) so the effect re-subscribes when that changes — mutating scrollRef.current in
  // place doesn't itself change the ref OBJECT's identity, so effect deps alone can't see it.
  refreshKey?: unknown;
  // "vertical" (default): track matches the anchor's own top/height, thumb tracks scrollTop —
  // for hiding a native scrollbar under a sticky header. "horizontal": track matches the anchor's
  // own left/width, thumb tracks scrollLeft, and the track's vertical position pins to the viewport
  // bottom (see viewportBottomInsetPx) rather than the anchor's own edge — for a horizontal
  // scrollbar whose real bottom edge can end up below the viewport.
  orientation?: "vertical" | "horizontal";
  side?: "left" | "right";
  insetPx?: number;
  // Must stay BELOW any sticky/fixed header rendered inside the same scroll container, so that
  // header keeps correctly painting over the thumb wherever they overlap (vertical mode only).
  zIndexClassName?: string;
  thumbWidthPx?: number;
  // Horizontal mode only: how far above the viewport's own bottom edge the track sits, clamped to
  // the anchor's own bottom edge once that's within view (so it docks flush there rather than
  // floating with a visible gap once the whole board fits on screen).
  viewportBottomInsetPx?: number;
  // Extra classes on the track's own outer div — e.g. a responsive `hidden lg:block` to scope a
  // horizontal replacement to desktop, where dragging a scrollbar is the expected interaction
  // (mobile already has native touch-swipe scrolling on the same container).
  trackClassName?: string;
}) {
  const isHorizontal = orientation === "horizontal";
  // `top`/`bottom` are mutually exclusive (exactly one is a number, the other null → CSS "auto") —
  // see the horizontal-mode branch below for why: pinning via CSS `bottom` instead of a JS-computed
  // `top: window.innerHeight - ...` sidesteps devicePixelRatio/zoom sub-pixel rounding entirely for
  // the common (not-yet-docked) case, rather than trying to round a JS value to match it.
  const [track, setTrack] = useState<{ left: number; top: number | null; bottom: number | null; width: number; height: number } | null>(null);
  // The thumb's length, or null when there's nothing to scroll. Its position along the track changes on
  // every scroll frame, so that's written straight onto the thumb element (thumbElRef, as a transform)
  // rather than kept in React state — which re-rendered this component on every frame of a scroll.
  const [thumbLength, setThumbLength] = useState<number | null>(null);
  const thumbElRef = useRef<HTMLDivElement | null>(null);
  const thumbOffsetRef = useRef(0);
  const draggingRef = useRef<{
    start: number;
    startScroll: number;
    maxThumbOffset: number;
    scrollableDist: number;
  } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    const anchorEl = anchorRef?.current ?? el;
    if (!el || !anchorEl) return;
    // Bails out (returns the SAME state reference) when the freshly computed value is equal to
    // what's already there, instead of always setting a brand-new object — plain setTrack/setThumb
    // calls built a fresh object literal every time, which React treats as "changed" regardless of
    // whether the actual numbers moved, re-rendering this component (and reconciling its portal)
    // on every single scroll tick even during a pure vertical scroll where the track's position
    // never actually changes. Confirmed contributor to mouse-wheel scroll lag in the
    // Quote/Specifications windows, which render this directly on their own main scroll container.
    const setTrackIfChanged = (next: typeof track) => {
      setTrack((prev) => {
        if (prev === next) return prev;
        if (prev && next && prev.left === next.left && prev.top === next.top && prev.bottom === next.bottom && prev.width === next.width && prev.height === next.height) {
          return prev;
        }
        return next;
      });
    };
    const setThumbIfChanged = (next: { offset: number; length: number } | null) => {
      if (next) {
        thumbOffsetRef.current = next.offset;
        const node = thumbElRef.current;
        if (node) node.style.transform = isHorizontal ? `translateX(${next.offset}px)` : `translateY(${next.offset}px)`;
      }
      const length = next ? next.length : null;
      setThumbLength((prev) => (prev === length ? prev : length));
    };
    const update = () => {
      // The document scrolls against the viewport, not its own (scrolled, page-tall) box.
      const anchorBox =
        el === document.documentElement
          ? { left: 0, top: 0, right: el.clientWidth, bottom: el.clientHeight, width: el.clientWidth, height: el.clientHeight }
          : anchorEl.getBoundingClientRect();
      if (isHorizontal) {
        // Whether the anchor's own real bottom edge is currently within the viewport decides HOW
        // the track is positioned, not just WHERE:
        //  - Not docked (the common case: the board's natural bottom edge is below the fold) — pin
        //    via CSS `bottom` alone, with NO `top`/window.innerHeight arithmetic involved at all.
        //    A JS-computed `top: window.innerHeight - inset - thumbWidthPx` looks equivalent on
        //    paper, but window.innerHeight is a CSS-pixel value rounded from the OS's own device-
        //    pixel viewport height — at a fractional devicePixelRatio (125%/150% Windows display
        //    scaling, or non-100% browser zoom) that rounding doesn't necessarily land on the same
        //    device-pixel row the browser's own `bottom: 0` layout resolves to, which is exactly
        //    the kind of hairline, zoom-level-dependent overshoot this was reported as. CSS
        //    `bottom` is resolved natively by the browser's own layout/compositor, so it's already
        //    correct at whatever the real DPR/zoom is, with nothing for this code to get wrong.
        //  - Docked (the anchor's real bottom edge has scrolled into view) — this genuinely needs a
        //    measured `top` (there's no viewport edge to pin `bottom` to anymore), so fall back to
        //    that, still rounded to a whole CSS pixel as a defensive measure for this one case.
        const dockedTop = anchorBox.bottom - thumbWidthPx;
        const isDocked = anchorBox.bottom <= window.innerHeight;
        setTrackIfChanged({
          left: anchorBox.left,
          width: anchorBox.width,
          top: isDocked ? Math.round(dockedTop) : null,
          bottom: isDocked ? null : viewportBottomInsetPx,
          height: thumbWidthPx,
        });
        if (el.scrollWidth <= el.clientWidth + 1) {
          setThumbIfChanged(null);
          return;
        }
        const ratio = el.clientWidth / el.scrollWidth;
        const thumbLength = Math.max(24, anchorBox.width * ratio);
        const maxThumbOffset = anchorBox.width - thumbLength;
        const scrollableDist = el.scrollWidth - el.clientWidth;
        const scrollRatio = scrollableDist > 0 ? el.scrollLeft / scrollableDist : 0;
        setThumbIfChanged({ offset: scrollRatio * maxThumbOffset, length: thumbLength });
        return;
      }
      const trackLeft = side === "left" ? anchorBox.left + insetPx : anchorBox.right - insetPx - thumbWidthPx;
      // Starts below any title bars over the container's top edge.
      const trackTop = titleBarsBottom(anchorBox.top, anchorBox.bottom, trackLeft, trackLeft + thumbWidthPx);
      const trackHeight = Math.max(0, anchorBox.bottom - trackTop);
      setTrackIfChanged({
        left: trackLeft,
        top: trackTop,
        bottom: null,
        width: thumbWidthPx,
        height: trackHeight,
      });
      if (el.scrollHeight <= el.clientHeight + 1 || trackHeight < 32) {
        setThumbIfChanged(null);
        return;
      }
      const ratio = el.clientHeight / el.scrollHeight;
      const thumbHeight = Math.max(24, trackHeight * ratio);
      const maxThumbTop = trackHeight - thumbHeight;
      const scrollableDist = el.scrollHeight - el.clientHeight;
      const scrollRatio = scrollableDist > 0 ? el.scrollTop / scrollableDist : 0;
      setThumbIfChanged({ offset: scrollRatio * maxThumbTop, length: thumbHeight });
    };
    update();
    // Coalesces potentially many scroll/resize events firing within the same frame (a fast
    // mouse-wheel gesture can fire far more scroll events per second than the screen can even
    // show a difference for) down to at most one recompute per animation frame — update() forces
    // a synchronous getBoundingClientRect() layout read, so running it once per raw event was
    // doing many times more layout work than necessary and was a confirmed contributor to
    // mouse-wheel scroll lag in the Quote/Specifications windows (which render this directly on
    // their own main scroll container).
    let rafId: number | null = null;
    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        update();
      });
    };
    // A resize or a layout change can add, remove or move title bars — look for them again.
    const scheduleRelayout = () => {
      invalidateTitleBars();
      scheduleUpdate();
    };
    el.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleRelayout);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleRelayout) : null;
    ro?.observe(anchorEl);
    if (anchorEl !== el) ro?.observe(el);
    // Horizontal mode's track position depends on the anchor's own bottom edge relative to the
    // viewport, which moves on ordinary page scroll — the vertical mode's track already tracks the
    // anchor 1:1 via ResizeObserver/scroll-on-el alone, so the extra page-scroll listener above is
    // only actually needed for horizontal, but harmless (just a redundant recompute) either way.
    return () => {
      el.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleRelayout);
      ro?.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [scrollRef, anchorRef, orientation, isHorizontal, side, insetPx, thumbWidthPx, viewportBottomInsetPx, refreshKey]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = draggingRef.current;
      const el = scrollRef.current;
      if (!drag || !el || drag.maxThumbOffset <= 0) return;
      const delta = (isHorizontal ? event.clientX : event.clientY) - drag.start;
      const scrollPerPx = drag.scrollableDist / drag.maxThumbOffset;
      const next = Math.min(drag.scrollableDist, Math.max(0, drag.startScroll + delta * scrollPerPx));
      if (isHorizontal) el.scrollLeft = next;
      else el.scrollTop = next;
    };
    const onUp = () => {
      draggingRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [scrollRef, isHorizontal]);

  if (!track || thumbLength === null || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`pointer-events-none fixed ${zIndexClassName} ${trackClassName}`}
      style={{
        left: track.left,
        top: track.top ?? "auto",
        bottom: track.bottom ?? "auto",
        width: track.width,
        height: track.height,
      }}
    >
      <div
        ref={(node) => {
          thumbElRef.current = node;
          // Put a freshly shown thumb where the last update said it belongs.
          if (node) {
            node.style.transform = isHorizontal ? `translateX(${thumbOffsetRef.current}px)` : `translateY(${thumbOffsetRef.current}px)`;
          }
        }}
        onPointerDown={(event) => {
          const el = scrollRef.current;
          const anchorEl = anchorRef?.current ?? el;
          if (!el || !anchorEl) return;
          const box = anchorEl.getBoundingClientRect();
          if (isHorizontal) {
            const ratio = el.clientWidth / el.scrollWidth;
            const thumbLength = Math.max(24, box.width * ratio);
            draggingRef.current = {
              start: event.clientX,
              startScroll: el.scrollLeft,
              maxThumbOffset: box.width - thumbLength,
              scrollableDist: el.scrollWidth - el.clientWidth,
            };
            return;
          }
          // The track's own height (it starts below the title bars), same as update() used.
          const ratio = el.clientHeight / el.scrollHeight;
          const thumbHeight = Math.max(24, track.height * ratio);
          draggingRef.current = {
            start: event.clientY,
            startScroll: el.scrollTop,
            maxThumbOffset: track.height - thumbHeight,
            scrollableDist: el.scrollHeight - el.clientHeight,
          };
        }}
        className="pointer-events-auto absolute rounded-full transition-colors"
        // "grab", not "pointer" — this is a drag handle, not a link/button, and AppShell's own
        // app-wide text-selection guard (see its isDragSource comment) specifically looks for a
        // grab/grabbing/resize cursor to recognize a drag source without needing every one
        // individually tagged. With "pointer" here, dragging this thumb wasn't recognized as a
        // drag at all, so nothing suppressed selection for its gesture — every scrollbar drag was
        // also select-dragging whatever text sat under the pointer's path.
        style={
          isHorizontal
            ? { top: 0, left: 0, width: thumbLength, height: thumbWidthPx, backgroundColor: "var(--custom-scrollbar-thumb)", cursor: "grab" }
            : { left: 0, top: 0, height: thumbLength, width: thumbWidthPx, backgroundColor: "var(--custom-scrollbar-thumb)", cursor: "grab" }
        }
        onMouseEnter={(event) => {
          event.currentTarget.style.backgroundColor = "var(--custom-scrollbar-thumb-hover)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.backgroundColor = "var(--custom-scrollbar-thumb)";
        }}
      />
    </div>,
    document.body,
  );
}
