import { useEffect, useState, type RefObject } from "react";

// A sticky header that floats as a bubble once it's held (the Production and Initial Measure cutlists' Cutlist Entry
// top). Returns whether it's held now — told by a marker just above it passing the line it's held at (holdOffset below
// the top of its scrolling area). While it is, the elements scrolling under it (clipRefs) are cut off at the bubble's
// top, following its round corners (inset in from the header's sides, radius) — gone once they reach it rather than
// seen above it, nothing painted over them. Their clips are drawn straight on them as it scrolls (no re-render).
// remountKey: anything that changes when the marker comes or goes (the room shown, the view opened).
export function useFloatingStickyHeader({
  scrollEl,
  markerRef,
  headerRef,
  clipRefs,
  holdOffset,
  inset,
  radius = 18,
  remountKey,
}: {
  scrollEl: HTMLElement | null;
  markerRef: RefObject<HTMLElement | null>;
  headerRef: RefObject<HTMLElement | null>;
  clipRefs: ReadonlyArray<RefObject<HTMLElement | null>>;
  holdOffset: number;
  inset: number;
  radius?: number;
  remountKey?: string;
}): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker || !scrollEl || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) + holdOffset),
      { root: scrollEl, rootMargin: `-${holdOffset}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(marker);
    // (Let go when it's gone — the room or view changed — the next one told afresh as soon as it's watched.)
    return () => {
      observer.disconnect();
      setStuck(false);
    };
  }, [scrollEl, markerRef, holdOffset, remountKey]);
  useEffect(() => {
    const clipped = () => clipRefs.map((ref) => ref.current).filter((el): el is HTMLElement => Boolean(el));
    if (!stuck || !scrollEl) {
      clipped().forEach((el) => {
        el.style.clipPath = "";
      });
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const header = headerRef.current;
      if (!header) return;
      const bubble = header.getBoundingClientRect();
      clipped().forEach((el) => {
        const box = el.getBoundingClientRect();
        const top = bubble.top - box.top;
        const left = bubble.left + inset - box.left;
        const right = bubble.right - inset - box.left;
        el.style.clipPath =
          `path("M -9999 ${top + radius} L ${left} ${top + radius} A ${radius} ${radius} 0 0 1 ${left + radius} ${top} ` +
          `L ${right - radius} ${top} A ${radius} ${radius} 0 0 1 ${right} ${top + radius} L 9999 ${top + radius} L 9999 99999 L -9999 99999 Z")`;
      });
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scrollEl.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      clipped().forEach((el) => {
        el.style.clipPath = "";
      });
    };
  }, [stuck, scrollEl, headerRef, clipRefs, inset, radius]);
  return stuck;
}
