"use client";

// The page glided up to its top, then `then` — straight away if it's already there (or for reduced motion, after a jump).
// E.g. the Dashboard's and Leads' columns / list switch: rather than the page jumping as the other view takes the place
// of this one, it slides up first and changes over at the top. The page's scroller is <main> on a phone or tablet, the
// document on a computer — whichever is scrolled. Pressed again while it's gliding: nothing (it's already on its way).

let sliding = false;

export function slideToTopThen(then: () => void): void {
  if (typeof window === "undefined") {
    then();
    return;
  }
  if (sliding) return;
  const page = document.scrollingElement as HTMLElement | null;
  const scroller = [document.querySelector<HTMLElement>("main"), page].find((el): el is HTMLElement => Boolean(el && el.scrollTop > 2));
  if (!scroller) {
    then();
    return;
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    scroller.scrollTop = 0;
    then();
    return;
  }
  sliding = true;
  // (The document's own scrolling is heard on the window, not on the document.)
  const heard: HTMLElement | Window = scroller === page ? window : scroller;
  let timer = 0;
  const finish = () => {
    if (!sliding) return;
    sliding = false;
    heard.removeEventListener("scroll", onScroll);
    window.clearTimeout(timer);
    // (Not quite there yet: the rest of the way at once, so the other view starts at the top.)
    if (scroller.scrollTop > 1) scroller.scrollTop = 0;
    then();
  };
  const onScroll = () => {
    if (scroller.scrollTop <= 1) finish();
  };
  heard.addEventListener("scroll", onScroll, { passive: true });
  // (In case it never quite gets there — a finger stops it, or frames are held back.)
  timer = window.setTimeout(finish, 900);
  scroller.scrollTo({ top: 0, behavior: "smooth" });
}
