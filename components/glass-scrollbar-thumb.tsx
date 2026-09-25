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
// Usage (horizontal): pass orientation="horizontal". Instead of matching the anchor's own top/height
// (vertical mode's behavior, meant to sit flush against a sticky header), the track pins its `top`
// to whichever is smaller — the anchor's own bottom edge, or the viewport's — so the thumb stays
// reachable even when the scroll container's natural bottom edge (where its native scrollbar would
// render) is currently scrolled below the viewport.
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
  const [thumb, setThumb] = useState<{ offset: number; length: number } | null>(null);
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
    const update = () => {
      const anchorBox = anchorEl.getBoundingClientRect();
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
        setTrack({
          left: anchorBox.left,
          width: anchorBox.width,
          top: isDocked ? Math.round(dockedTop) : null,
          bottom: isDocked ? null : viewportBottomInsetPx,
          height: thumbWidthPx,
        });
        if (el.scrollWidth <= el.clientWidth + 1) {
          setThumb(null);
          return;
        }
        const ratio = el.clientWidth / el.scrollWidth;
        const thumbLength = Math.max(24, anchorBox.width * ratio);
        const maxThumbOffset = anchorBox.width - thumbLength;
        const scrollableDist = el.scrollWidth - el.clientWidth;
        const scrollRatio = scrollableDist > 0 ? el.scrollLeft / scrollableDist : 0;
        setThumb({ offset: scrollRatio * maxThumbOffset, length: thumbLength });
        return;
      }
      setTrack({
        left: side === "left" ? anchorBox.left + insetPx : anchorBox.right - insetPx - thumbWidthPx,
        top: anchorBox.top,
        bottom: null,
        width: thumbWidthPx,
        height: anchorBox.height,
      });
      if (el.scrollHeight <= el.clientHeight + 1) {
        setThumb(null);
        return;
      }
      const ratio = el.clientHeight / el.scrollHeight;
      const thumbHeight = Math.max(24, anchorBox.height * ratio);
      const maxThumbTop = anchorBox.height - thumbHeight;
      const scrollableDist = el.scrollHeight - el.clientHeight;
      const scrollRatio = scrollableDist > 0 ? el.scrollTop / scrollableDist : 0;
      setThumb({ offset: scrollRatio * maxThumbTop, length: thumbHeight });
    };
    update();
    el.addEventListener("scroll", update);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(anchorEl);
    if (anchorEl !== el) ro?.observe(el);
    // Horizontal mode's track position depends on the anchor's own bottom edge relative to the
    // viewport, which moves on ordinary page scroll — the vertical mode's track already tracks the
    // anchor 1:1 via ResizeObserver/scroll-on-el alone, so the extra page-scroll listener above is
    // only actually needed for horizontal, but harmless (just a redundant recompute) either way.
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro?.disconnect();
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

  if (!track || !thumb || typeof document === "undefined") return null;

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
          const ratio = el.clientHeight / el.scrollHeight;
          const thumbHeight = Math.max(24, box.height * ratio);
          draggingRef.current = {
            start: event.clientY,
            startScroll: el.scrollTop,
            maxThumbOffset: box.height - thumbHeight,
            scrollableDist: el.scrollHeight - el.clientHeight,
          };
        }}
        className="pointer-events-auto absolute rounded-full transition-colors"
        style={
          isHorizontal
            ? { top: 0, left: thumb.offset, width: thumb.length, height: thumbWidthPx, backgroundColor: "var(--custom-scrollbar-thumb)", cursor: "pointer" }
            : { left: 0, top: thumb.offset, height: thumb.length, width: thumbWidthPx, backgroundColor: "var(--custom-scrollbar-thumb)", cursor: "pointer" }
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
