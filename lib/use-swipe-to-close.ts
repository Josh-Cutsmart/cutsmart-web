import { useEffect, useRef, useState, type RefObject, type TouchEvent as ReactTouchEvent } from "react";

export type SwipeToCloseOptions = {
  duration?: number;
  easing?: string;
  // Which edge the panel is anchored to and slides off toward when closing —
  // "left" for a drawer that slides in from the left (sidebar nav), "right"
  // for one that slides in from the right (notifications).
  edge: "left" | "right";
  // Fraction of the panel's own width a drag must cross before release commits
  // to closing instead of snapping back open.
  closeThreshold?: number;
  // Optional element that gets visually "pushed" out of the way in sync with the panel's own
  // open/close/drag motion — e.g. the page's <main> content — so the drawer reads as sliding
  // the whole page over rather than an overlay laid on top of static content underneath.
  pushRef?: RefObject<HTMLElement | null>;
};

type DragState = {
  startX: number;
  startY: number;
  width: number;
  dragging: boolean;
  axisLocked: "x" | "y" | null;
};

function findSwipeBackdrop(panel: HTMLElement): HTMLElement | null {
  const parent = panel.parentElement;
  if (!parent) return null;
  if (parent.hasAttribute("data-swipe-backdrop")) return parent;
  return parent.querySelector<HTMLElement>("[data-swipe-backdrop]");
}

// Same "keep rendering one extra beat so the close animation has something to
// animate" shape as useGlassModalPopOrigin, but for an edge-anchored slide-out
// drawer (mobile nav / notifications) instead of a pop-from-button modal:
// slides in on open, drags the panel (and optionally the page content behind
// it) 1:1 with the finger while touching, then either snaps back open or
// finishes the close with a matching CSS transition on release.
export function useSwipeToClose(
  isOpen: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLDivElement | null>,
  options: SwipeToCloseOptions,
): {
  shouldRender: boolean;
  touchHandlers: {
    onTouchStart: (e: ReactTouchEvent<HTMLElement>) => void;
    onTouchMove: (e: ReactTouchEvent<HTMLElement>) => void;
    onTouchEnd: () => void;
  };
} {
  const duration = options.duration ?? 260;
  const easing = options.easing ?? "cubic-bezier(0.32, 0.72, 0, 1)";
  const edge = options.edge;
  const closeThreshold = options.closeThreshold ?? 0.35;
  const pushRef = options.pushRef;
  // -1 for "left" (closed = translateX(-100%), dragging left is the closing direction),
  // +1 for "right" (closed = translateX(100%), dragging right is the closing direction).
  const sign = edge === "left" ? -1 : 1;
  const [shouldRender, setShouldRender] = useState(isOpen);
  const dragRef = useRef<DragState>({ startX: 0, startY: 0, width: 0, dragging: false, axisLocked: null });

  if (isOpen && !shouldRender) {
    // Same render-time sync as useGlassModalPopOrigin — mounts in the same pass `isOpen`
    // flips true rather than a one-frame-late extra render.
    setShouldRender(true);
  }

  // Moves the push target by `progress` (0 = at rest, 1 = panel fully open) in the SAME
  // direction the panel is entering from, so it reads as being shoved out of the way rather
  // than just sitting underneath the panel. See the edge/sign comment above: the panel's own
  // resting-closed transform is `sign * 100%`, so the content it pushes moves the opposite way.
  // panelWidthPx (not a percentage of the push target's OWN width) is what keeps the two moving
  // at the same speed — translateX(N%) is relative to the element it's applied to, so using `%`
  // here meant the page (often a different width than the panel, e.g. a 280px drawer sliding over
  // a 390px-wide page) tracked the finger/panel at the wrong rate, most visible on whichever of
  // nav/notif has the bigger width mismatch against the page.
  const applyPush = (progress: number, transition: string, panelWidthPx: number) => {
    const push = pushRef?.current;
    if (!push) return;
    push.style.transition = transition;
    push.style.transform = progress === 0 ? "" : `translateX(${-sign * progress * panelWidthPx}px)`;
  };

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      if (!isOpen) {
        const noPanelTimeout = window.setTimeout(() => setShouldRender(false), 0);
        return () => window.clearTimeout(noPanelTimeout);
      }
      return;
    }
    const backdrop = findSwipeBackdrop(panel);
    const transition = `transform ${duration}ms ${easing}`;
    const panelWidthPx = panel.getBoundingClientRect().width;
    if (isOpen) {
      // Force the panel (and push target) to their closed positions first, with no transition,
      // then transition to open — so a fresh open always plays the same slide-in regardless of
      // whether this is the very first mount or a re-open after a previous close.
      panel.style.transition = "none";
      panel.style.transform = `translateX(${sign * 100}%)`;
      applyPush(0, "none", panelWidthPx);
      if (backdrop) {
        backdrop.style.transition = "none";
        backdrop.style.opacity = "0";
      }
      // Force a reflow on BOTH the panel and the page it pushes so the browser actually paints
      // their closed positions above before the transition below is applied — otherwise both
      // style writes coalesce into one frame and there's nothing to animate from. Reading only the
      // panel's own offsetWidth here (not the push target's too) left room for the two elements'
      // CSS transitions to start on different frames — a fixed head-start/lag baked in from the
      // very first frame of the animation and held for its entire duration, reading as the page
      // steadily pulling away from the panel while it slides open. Reading both up front makes
      // sure neither one is still mid-flush when the transition below kicks in for either.
      void panel.offsetWidth;
      if (pushRef?.current) void pushRef.current.offsetWidth;
      panel.style.transition = transition;
      panel.style.transform = "translateX(0px)";
      applyPush(1, transition, panelWidthPx);
      if (backdrop) {
        backdrop.style.transition = `opacity ${duration}ms ease`;
        backdrop.style.opacity = "1";
      }
      const clear = () => {
        panel.style.transition = "";
      };
      panel.addEventListener("transitionend", clear, { once: true });
      return () => panel.removeEventListener("transitionend", clear);
    }
    // Closing: slide the panel off toward its own edge (and un-push the page content in
    // lockstep) then actually stop rendering once the transition finishes. If a swipe already
    // left the panel partway closed, this transitions from wherever it currently sits (not from
    // fully open), so a released drag continues its own momentum instead of jumping back first.
    if (backdrop) {
      backdrop.style.transition = `opacity ${duration}ms ease`;
      backdrop.style.opacity = "0";
    }
    panel.style.transition = transition;
    panel.style.transform = `translateX(${sign * 100}%)`;
    applyPush(0, transition, panelWidthPx);
    const timeout = window.setTimeout(() => setShouldRender(false), duration);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyPush is a plain closure recreated every render, not state
  }, [isOpen, duration, easing, sign, panelRef]);

  const onTouchStart = (e: ReactTouchEvent<HTMLElement>) => {
    const touch = e.touches[0];
    const panel = panelRef.current;
    if (!touch || !panel) return;
    dragRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      width: panel.getBoundingClientRect().width,
      dragging: true,
      axisLocked: null,
    };
  };

  const onTouchMove = (e: ReactTouchEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const touch = e.touches[0];
    const panel = panelRef.current;
    if (!drag.dragging || !touch || !panel) return;
    const dx = touch.clientX - drag.startX;
    const dy = touch.clientY - drag.startY;
    if (!drag.axisLocked) {
      // Wait for a real, unambiguous direction before committing to either a horizontal
      // swipe-to-close or leaving the gesture alone (e.g. vertical scroll of the panel's
      // own nav list) — a few px of jitter right at touch-down shouldn't decide it.
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      drag.axisLocked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (drag.axisLocked === "y") return;
    e.preventDefault();
    // Only the closing direction moves the panel — dragging the "wrong" way (back toward
    // fully open) has no effect rather than overshooting past the resting position.
    const closingDx = edge === "left" ? Math.min(dx, 0) : Math.max(dx, 0);
    panel.style.transition = "none";
    panel.style.transform = `translateX(${closingDx}px)`;
    const progress = drag.width > 0 ? 1 - Math.abs(closingDx) / drag.width : 1;
    applyPush(progress, "none", drag.width);
  };

  const onTouchEnd = () => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag.dragging) return;
    drag.dragging = false;
    if (!panel || drag.axisLocked !== "x") return;
    const match = /translateX\(([-\d.]+)px\)/.exec(panel.style.transform);
    const currentDx = match ? Number.parseFloat(match[1]) : 0;
    const progress = drag.width > 0 ? Math.abs(currentDx) / drag.width : 0;
    if (progress > closeThreshold) {
      onClose();
      return;
    }
    const transition = `transform ${duration}ms ${easing}`;
    panel.style.transition = transition;
    panel.style.transform = "translateX(0px)";
    applyPush(1, transition, drag.width);
  };

  return { shouldRender, touchHandlers: { onTouchStart, onTouchMove, onTouchEnd } };
}
