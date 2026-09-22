"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

// A plain-div replacement for a scroll container's native scrollbar — needed anywhere content is
// meant to scroll under a fixed/sticky glass header. A native scrollbar can't be covered by any
// amount of z-index/opacity/background trickery: it renders in the browser's own compositing
// layer, which sits above ordinary page content regardless of stacking context (confirmed
// empirically — a fully opaque cover div placed directly over one still didn't hide it). A plain
// div has none of that problem: it's ordinary content, so any existing sticky/fixed header with a
// higher z-index already correctly paints over it exactly like it would over anything else,
// naturally "stopping" the visible thumb right at the header's edge.
//
// Usage: give the scroll container `overflow-y-auto hide-native-scrollbar`, then render
// <GlassScrollbarThumb scrollRef={thatContainersRef} /> anywhere (it portals to document.body and
// measures the container's own on-screen position, so it works whether that container is a
// full-viewport page or a small modal's own scroll box).
export function GlassScrollbarThumb({
  scrollRef,
  anchorRef,
  refreshKey,
  side = "right",
  insetPx = 2,
  zIndexClassName = "z-[80]",
  thumbWidthPx = 6,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  // Element whose bounding box positions the track (left/top/height) — defaults to scrollRef's
  // own element. Pass a separate, non-scrolling ancestor when scrollRef itself is one page of a
  // horizontally-paged row (e.g. Nesting/CNC's mobile board-type swiper): the page's own bounding
  // box moves left/right as it scrolls into and out of view, which would otherwise drag the thumb
  // along with the horizontal swipe instead of leaving it parked at a fixed screen position.
  anchorRef?: RefObject<HTMLElement | null>;
  // Include whatever identifies "which element scrollRef.current now points at" (e.g. an active
  // board key) so the effect re-subscribes when that changes — mutating scrollRef.current in
  // place doesn't itself change the ref OBJECT's identity, so effect deps alone can't see it.
  refreshKey?: unknown;
  side?: "left" | "right";
  insetPx?: number;
  // Must stay BELOW any sticky/fixed header rendered inside the same scroll container, so that
  // header keeps correctly painting over the thumb wherever they overlap.
  zIndexClassName?: string;
  thumbWidthPx?: number;
}) {
  const [track, setTrack] = useState<{ left: number; top: number; height: number } | null>(null);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);
  const draggingRef = useRef<{ startY: number; startScrollTop: number; maxThumbTop: number; scrollableDist: number } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    const anchorEl = anchorRef?.current ?? el;
    if (!el || !anchorEl) return;
    const update = () => {
      const anchorBox = anchorEl.getBoundingClientRect();
      setTrack({
        left: side === "left" ? anchorBox.left + insetPx : anchorBox.right - insetPx - thumbWidthPx,
        top: anchorBox.top,
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
      setThumb({ top: scrollRatio * maxThumbTop, height: thumbHeight });
    };
    update();
    el.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(anchorEl);
    if (anchorEl !== el) ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, [scrollRef, anchorRef, side, insetPx, thumbWidthPx, refreshKey]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = draggingRef.current;
      const el = scrollRef.current;
      if (!drag || !el || drag.maxThumbTop <= 0) return;
      const deltaY = event.clientY - drag.startY;
      const scrollPerPx = drag.scrollableDist / drag.maxThumbTop;
      el.scrollTop = Math.min(drag.scrollableDist, Math.max(0, drag.startScrollTop + deltaY * scrollPerPx));
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
  }, [scrollRef]);

  if (!track || !thumb || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`pointer-events-none fixed ${zIndexClassName}`}
      style={{ left: track.left, top: track.top, height: track.height, width: thumbWidthPx }}
    >
      <div
        onPointerDown={(event) => {
          const el = scrollRef.current;
          const anchorEl = anchorRef?.current ?? el;
          if (!el || !anchorEl) return;
          const box = anchorEl.getBoundingClientRect();
          const ratio = el.clientHeight / el.scrollHeight;
          const thumbHeight = Math.max(24, box.height * ratio);
          draggingRef.current = {
            startY: event.clientY,
            startScrollTop: el.scrollTop,
            maxThumbTop: box.height - thumbHeight,
            scrollableDist: el.scrollHeight - el.clientHeight,
          };
        }}
        className="pointer-events-auto absolute rounded-full transition-colors"
        style={{
          left: 0,
          top: thumb.top,
          height: thumb.height,
          width: thumbWidthPx,
          backgroundColor: "var(--custom-scrollbar-thumb)",
          cursor: "pointer",
        }}
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
