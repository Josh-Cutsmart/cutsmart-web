"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject, type TouchEvent as ReactTouchEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, type LucideIcon } from "lucide-react";

// Phone pages that slide in from the right over the page they're opened from (which slides away left) —
// Contacts' and the notification categories' own pattern. Back, the phone's back gesture/button, or a
// swipe right returns. They can nest: a page opened from inside one passes that one's paneRef as its
// pageRef, and the deeper page keeps its own history entry, so Back closes one page at a time.

const PHONE_QUERY = "(max-width: 767.98px)";
const subscribePhone = (onChange: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const readPhone = () => window.matchMedia(PHONE_QUERY).matches;

// Whether the screen is phone-sized (the width the slide-over pages are for).
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, readPhone, () => false);
}

const SLIDE_CLASS = "transition-transform duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";
const SLIDE_TRANSITION = "transform 260ms cubic-bezier(0.32, 0.72, 0, 1)";
const CLOSE_MS = 320;

function slidePage(page: HTMLElement | null | undefined, open: boolean, animate = true) {
  if (!page) return;
  page.style.transition = animate ? SLIDE_TRANSITION : "none";
  page.style.transform = open ? "translate3d(-100%, 0, 0)" : "";
}

export type SlideOverPage = {
  // The page that's open (kept while it slides closed), and whether it's open.
  openId: string;
  isOpen: boolean;
  open: (id: string) => void;
  close: () => void;
  paneRef: RefObject<HTMLDivElement | null>;
  touchHandlers: {
    onTouchStart: (event: ReactTouchEvent<HTMLDivElement>) => void;
    onTouchMove: (event: ReactTouchEvent<HTMLDivElement>) => void;
    onTouchEnd: (event: ReactTouchEvent<HTMLDivElement>) => void;
    onTouchCancel: (event: ReactTouchEvent<HTMLDivElement>) => void;
  };
};

// `pageRef` is the page underneath; `historyKey` names this level's entry in the browser history.
export function useSlideOverPage(pageRef: RefObject<HTMLElement | null>, historyKey: string): SlideOverPage {
  const [openId, setOpenId] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const pushedEntryRef = useRef(false);
  const paneRef = useRef<HTMLDivElement | null>(null);

  const finishClosing = () => {
    setIsOpen(false);
    slidePage(pageRef.current, false);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpenId("");
      if (pageRef.current) pageRef.current.style.transition = "";
    }, CLOSE_MS);
  };

  const open = (id: string) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpenId(id);
    window.history.pushState({ ...(window.history.state ?? {}), [historyKey]: id }, "");
    pushedEntryRef.current = true;
    // Next frame, so the pane mounts off-screen first and then slides.
    requestAnimationFrame(() => {
      setIsOpen(true);
      slidePage(pageRef.current, true);
    });
  };

  const close = () => {
    if (pushedEntryRef.current) {
      // Back through the entry opening it pushed — popstate (below) closes it.
      window.history.back();
      return;
    }
    finishClosing();
  };

  // Back (or the phone's back gesture/button) out of this page's entry closes it — not out of a deeper
  // page's entry, which leaves this one's in place.
  useEffect(() => {
    const onPopState = () => {
      if (!pushedEntryRef.current) return;
      const state = window.history.state as Record<string, unknown> | null;
      if (state?.[historyKey]) return;
      pushedEntryRef.current = false;
      setIsOpen(false);
      slidePage(pageRef.current, false);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setOpenId("");
        if (pageRef.current) pageRef.current.style.transition = "";
      }, CLOSE_MS);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [historyKey, pageRef]);

  // Leaving with a page open puts the page underneath back.
  useEffect(() => {
    const page = pageRef.current;
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      if (page) {
        page.style.transform = "";
        page.style.transition = "";
      }
    };
  }, [pageRef]);

  // Swipe right to go back: the pane and the page follow the finger; past a third of the width, or a quick
  // flick, finishes going back, otherwise it springs back.
  const swipeRef = useRef<{ x: number; y: number; t: number; width: number; axis: "" | "x" | "none"; dx: number } | null>(null);
  const setSwipeTransforms = (dx: number | null) => {
    const pane = paneRef.current;
    const page = pageRef.current;
    if (pane) pane.style.transform = dx === null ? "" : `translate3d(${dx}px, 0, 0)`;
    if (page) page.style.transform = dx === null ? "translate3d(-100%, 0, 0)" : `translate3d(calc(-100% + ${dx}px), 0, 0)`;
  };
  const setSwipeDragging = (dragging: boolean) => {
    const pane = paneRef.current;
    const page = pageRef.current;
    if (pane) pane.style.transition = dragging ? "none" : "";
    if (page) page.style.transition = dragging ? "none" : SLIDE_TRANSITION;
  };
  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    // Touches on a deeper page (portalled, but still inside this one in React) are that page's to handle.
    const inThisPane = paneRef.current?.contains(event.target as Node);
    if (!isOpen || !inThisPane || !touch || event.touches.length > 1 || document.querySelector('[data-glass-dropdown-menu="true"]')) {
      swipeRef.current = null;
      return;
    }
    swipeRef.current = { x: touch.clientX, y: touch.clientY, t: performance.now(), width: window.innerWidth, axis: "", dx: 0 };
  };
  const onTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    const touch = event.touches[0];
    if (!swipe || !touch || swipe.axis === "none") return;
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    if (!swipe.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      swipe.axis = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "none";
      if (swipe.axis !== "x") return;
      setSwipeDragging(true);
    }
    swipe.dx = Math.max(0, dx);
    setSwipeTransforms(swipe.dx);
  };
  const onTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    swipeRef.current = null;
    if (!swipe || swipe.axis !== "x") return;
    const velocity = swipe.dx / Math.max(1, performance.now() - swipe.t);
    setSwipeDragging(false);
    void paneRef.current?.offsetWidth;
    if (event.type !== "touchcancel" && (swipe.dx > swipe.width * 0.3 || (velocity > 0.5 && swipe.dx > 40))) {
      if (paneRef.current) paneRef.current.style.transform = "";
      close();
    } else {
      setSwipeTransforms(null);
    }
  };

  return { openId, isOpen, open, close, paneRef, touchHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd } };
}

// The sliding page itself (pass it everything useSlideOverPage returns): a short bar with its title (and
// icon) on the left, anything else then Back on the right, then its content. Without a title there's no
// bar — for a page that keeps its own bar fixed above (then `topClass` starts the pages below it).
export function SlideOverPane({
  openId,
  isOpen,
  close,
  paneRef,
  touchHandlers,
  title,
  titleIcon: TitleIcon,
  headerRight,
  topClass = "top-12",
  zIndexClass = "z-[29]",
  children,
}: Omit<SlideOverPage, "open"> & {
  title?: string;
  titleIcon?: LucideIcon;
  headerRight?: ReactNode;
  // Where it starts: under the app's tab bar, or lower.
  topClass?: string;
  // Deeper pages sit above the ones they open from.
  zIndexClass?: string;
  children: ReactNode;
}) {
  if (!openId || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={paneRef}
      {...touchHandlers}
      data-horizontal-swipe-scroll="true"
      className={`fixed inset-x-0 bottom-0 ${topClass} ${zIndexClass} flex touch-pan-y flex-col ${SLIDE_CLASS}`}
      style={{ transform: isOpen ? "translate3d(0, 0, 0)" : "translate3d(100%, 0, 0)", backgroundColor: "var(--bg-app, var(--panel-bg))" }}
    >
      {title ? (
        <div className="glass-page-header flex h-[44px] shrink-0 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            {TitleIcon ? <TitleIcon size={16} className="shrink-0" style={{ color: "var(--text-main)" }} strokeWidth={2.1} /> : null}
            <p className="truncate text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>{title}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerRight}
            <button
              type="button"
              onClick={close}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border hover:brightness-95"
              style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
              aria-label="Back"
            >
              <ChevronLeft size={18} color="#ffffff" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
