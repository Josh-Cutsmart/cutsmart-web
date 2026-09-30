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
  // A second, externally-driven drag for the OPPOSITE gesture — some other element entirely (e.g.
  // the main sheet behind this panel) swiping this panel open, rather than the panel's own header
  // dragging it shut. Kept on this same hook instance (not a separate one) so it can reuse the
  // panel/push/backdrop refs and the sign/duration/easing captured above instead of duplicating
  // them. See beginOpenDrag's own comment for why the caller drives this imperatively instead of
  // spreading a second touchHandlers object onto some element.
  beginOpenDrag: (onOpen: () => void) => void;
  updateOpenDrag: (dx: number) => void;
  endOpenDrag: (dx: number, commitThresholdPx: number, onCancel: () => void) => void;
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
  // Set for the whole lifetime of an external open-drag (beginOpenDrag through either
  // endOpenDrag branch) — read by the isOpen effect below so it can step aside instead of racing
  // the drag for control of the panel's transform. width is measured lazily on the first update
  // (see updateOpenDrag) since the panel has only just mounted when a drag begins.
  const openDragRef = useRef<{ active: boolean; width: number }>({ active: false, width: 0 });

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
        // The panel can already be unmounted by the time this effect sees isOpen go false —
        // e.g. isOpen is itself `isCompactProjectViewport && isXOpen` at the call site, so
        // rotating the device/resizing past the mobile breakpoint while a drawer is open flips
        // isOpen false in the SAME render that swaps the surrounding ternary from this mobile
        // drawer to its desktop fallback, unmounting panelRef's node before this effect ever
        // runs. With no panel to drive the normal close transition through, still reset the
        // push target directly here — otherwise it's left permanently mid-"shoved over" (a non-
        // empty inline transform, which is also a containing block for every position:fixed
        // descendant it parents — see pushRef's own comment), stuck until a full page reload.
        if (pushRef?.current) {
          pushRef.current.style.transition = "";
          pushRef.current.style.transform = "";
        }
        const noPanelTimeout = window.setTimeout(() => setShouldRender(false), 0);
        return () => window.clearTimeout(noPanelTimeout);
      }
      return;
    }
    if (isOpen && openDragRef.current.active) {
      // A live open-drag (beginOpenDrag/updateOpenDrag below) already has its hands on this
      // panel's transform and is driving it in real time off the finger — this effect's own
      // canned "force closed, then animate to open" sequence would immediately fight it for the
      // same style properties, reading as a one-frame flinch toward translateX(0) before the drag
      // catches up. endOpenDrag clears openDragRef.current.active once the drag itself resolves
      // (either finishing the open or handing off to the normal close animation on cancel), at
      // which point this effect is free to run again on the next isOpen change.
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

  // Called once, right when some OTHER element's touchmove first confirms a drag toward this
  // panel's open direction (see updateOpenDrag) — flips openDragRef so the isOpen effect above
  // steps aside, then calls the caller's onOpen (the same state setter a plain tap would use) to
  // mount the panel. Mounting is asynchronous (a render has to happen before panelRef.current
  // exists), which is why updateOpenDrag tolerates panel still being null on its first call or
  // two rather than requiring it here.
  const beginOpenDrag = (onOpen: () => void) => {
    if (openDragRef.current.active) return;
    openDragRef.current = { active: true, width: 0 };
    onOpen();
  };

  // dx: raw finger delta from wherever the caller's own gesture started (NOT from when this drag
  // began — the caller locks direction a few px into the touch, same deadzone as the close-drag's
  // own axisLocked check, so dx already reflects the whole gesture by the time this first fires).
  const updateOpenDrag = (dx: number) => {
    if (!openDragRef.current.active) return;
    const panel = panelRef.current;
    if (!panel) return; // Not mounted yet this tick — onOpen's state update hasn't committed/
    // painted yet. The next touchmove (a few ms later at most) will find it mounted instead.
    if (openDragRef.current.width === 0) {
      // First tick with a real panel to measure — these panels are always a full-viewport-width
      // takeover on mobile (see their own JSX), so this only ever runs once per drag. Seed the
      // panel/backdrop/push to the same fully-closed, transition-less starting point the isOpen
      // effect's own open branch would have, so this drag's very first visible frame is correct
      // regardless of how far the finger has already moved.
      openDragRef.current.width = panel.getBoundingClientRect().width || (typeof window === "undefined" ? 1 : window.innerWidth);
      panel.style.transition = "none";
      panel.style.transform = `translateX(${sign * 100}%)`;
      applyPush(0, "none", openDragRef.current.width);
      const backdrop = findSwipeBackdrop(panel);
      if (backdrop) {
        backdrop.style.transition = "none";
        backdrop.style.opacity = "0";
      }
      void panel.offsetWidth;
    }
    const width = openDragRef.current.width;
    // Only the opening direction (the opposite of the closing direction above) moves the panel —
    // dragging the "wrong" way (further toward closed) has no effect rather than overshooting
    // past the closed position.
    const openingDx = edge === "left" ? Math.max(0, Math.min(dx, width)) : Math.min(0, Math.max(dx, -width));
    const progress = width > 0 ? Math.abs(openingDx) / width : 0;
    panel.style.transition = "none";
    panel.style.transform = `translateX(${sign * 100 * (1 - progress)}%)`;
    applyPush(progress, "none", width);
    const backdrop = findSwipeBackdrop(panel);
    if (backdrop) backdrop.style.opacity = String(progress);
  };

  // commitThresholdPx: an absolute pixel distance (not a fraction of width, unlike closeThreshold
  // above) — the caller passes the SAME small threshold it used to use to decide "open" outright
  // before this drag existed, so adding live tracking doesn't also make the gesture itself harder
  // to trigger than it already was.
  const endOpenDrag = (dx: number, commitThresholdPx: number, onCancel: () => void) => {
    const panel = panelRef.current;
    const width = openDragRef.current.width;
    openDragRef.current = { active: false, width: 0 };
    if (!panel || width === 0) return;
    const openingDx = edge === "left" ? Math.max(0, Math.min(dx, width)) : Math.min(0, Math.max(dx, -width));
    if (Math.abs(openingDx) > commitThresholdPx) {
      // Finish sliding the rest of the way open with the same transition every other open/close
      // in this hook uses, exactly like the close-drag above snapping the rest of the way shut.
      const transition = `transform ${duration}ms ${easing}`;
      panel.style.transition = transition;
      panel.style.transform = "translateX(0px)";
      applyPush(1, transition, width);
      const backdrop = findSwipeBackdrop(panel);
      if (backdrop) {
        backdrop.style.transition = `opacity ${duration}ms ease`;
        backdrop.style.opacity = "1";
      }
      const clear = () => {
        panel.style.transition = "";
      };
      panel.addEventListener("transitionend", clear, { once: true });
      return;
    }
    // Didn't drag far enough to commit — the panel was already mounted (onOpen ran in
    // beginOpenDrag), so undo that the same way a real close would: hand off to onCancel (the
    // caller's usual close callback), which flips the external isOpen prop back false. openDragRef
    // is already cleared above, so the isOpen effect's own closing branch runs normally and
    // animates the rest of the way shut from wherever this drag left the panel, instead of the
    // effect seeing openDragRef still active and stepping aside with nothing left to finish the job.
    onCancel();
  };

  return {
    shouldRender,
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd },
    beginOpenDrag,
    updateOpenDrag,
    endOpenDrag,
  };
}
