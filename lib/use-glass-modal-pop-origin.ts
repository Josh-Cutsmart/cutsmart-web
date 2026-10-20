import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";

export type GlassModalOrigin = { left: number; top: number; width: number; height: number } | null;

// Reads a trigger button's on-screen box at click time — must be called from
// the button's own onClick (e.currentTarget), not read later, since a modal's
// autoFocus input steals document.activeElement the instant it mounts.
export function captureGlassModalOrigin(e: ReactMouseEvent<HTMLElement>): GlassModalOrigin {
  const rect = e.currentTarget.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

// Makes a glass modal panel visibly grow out of whichever button opened it,
// and shrink back into it on close: the panel is pinned to the button's exact
// on-screen box (no fade, fully opaque) then transitions to/from its natural
// centered size/position — a true FLIP animation rather than a scale-from-a-
// point trick, since the panel's dimensions aren't known ahead of layout. The
// backdrop (found automatically — either the panel's own parent or a sibling
// carrying the `.glass-modal-backdrop` class) fades in/out in lockstep.
export type GlassModalPopOriginOptions = { duration?: number; easing?: string; closingEasing?: string };

function findGlassModalBackdrop(panel: HTMLElement): HTMLElement | null {
  const parent = panel.parentElement;
  if (!parent) return null;
  if (parent.classList.contains("glass-modal-backdrop")) return parent;
  return parent.querySelector<HTMLElement>(".glass-modal-backdrop");
}

// How much longer the panel stays mounted, past its own shrink `duration`, once it's arrived at
// the origin — just long enough for the sunk-behind-the-origin state (see applyOriginArrival
// below) to actually be visible for a beat before the panel unmounts, instead of the two happening
// in the same instant (which would make the z-index drop invisible — nothing to see it happen to).
const ORIGIN_ARRIVAL_HOLD_MS = 140;
// useGlassModalPopOrigin's own default `duration` (see its own `options?.duration ?? ...` below) —
// named here too so DEFAULT_GLASS_MODAL_ORIGIN_CLOSE_HOLD_MS below can't silently drift out of sync
// with it.
const DEFAULT_DURATION_MS = 320;
// Total time a useGlassModalPopOrigin instance called with its DEFAULT duration (no
// options.duration override) and an originElRef stays mounted after `isOpen` goes false. A caller
// whose origin is a disappearing piece of content (e.g. a list row being deleted, not just hidden)
// should keep that row around in state for at least this long after starting the close, rather
// than removing it in the very same tick — removing it immediately pulls the close animation's own
// landing target out from under it, so the panel still shrinks toward the right on-screen spot but
// there's nothing left there for it to visually merge into (and by the time it arrives, any rows
// below may have already reflowed up to fill the gap) — reading as "doesn't animate back into the
// bubble" even though the mechanism itself ran. Only valid for a call site using the default
// duration/easing; one passing a custom `options.duration` needs its own matching value instead.
export const DEFAULT_GLASS_MODAL_ORIGIN_CLOSE_HOLD_MS = DEFAULT_DURATION_MS + ORIGIN_ARRIVAL_HOLD_MS;

// Optional, opt-in effects on/around the origin element itself (the button/tab the panel is
// shrinking back into), once the panel has fully arrived there — nothing calls this unless a
// caller actually passes `originElRef`, so every existing call site is unaffected. `el` is
// re-read from the ref fresh at the moment this fires (not captured once), and `.isConnected` is
// checked by the caller before invoking this — see the closing branches below — so a
// since-unmounted or since-replaced origin (a list row that got deleted/filtered out while its
// modal was still closing) is simply skipped rather than acting on a detached node.
function applyOriginArrival(panel: HTMLElement, el: HTMLElement, dx: number, dy: number) {
  // Sinks the WHOLE modal (backdrop + panel share one portaled wrapper — see findGlassModalBackdrop)
  // behind ordinary page content for its brief remaining hold — reads as the popup slipping BEHIND
  // the button it just landed on rather than sitting visibly on top of it. Safe to do now (not
  // earlier in the shrink): the backdrop's own fade-out finishes in lockstep with the panel's own
  // shrink, so by this point it's already invisible regardless of stacking order, and the panel
  // itself has shrunk down to exactly the origin's own box, so there's nothing else on screen for
  // dropping behind normal content to visibly disturb.
  // (What it was is kept on the wrapper — data-pop-arrival-z — for opening it again before it's gone: see the opening
  // branch below. Left sunk, an opened-again pop-up sat invisible behind the page, with no way to close it.)
  const wrapper = panel.parentElement;
  if (wrapper) {
    if (wrapper.dataset.popArrivalZ === undefined) wrapper.dataset.popArrivalZ = wrapper.style.zIndex;
    wrapper.style.zIndex = "-1";
  }

  // Belt-and-braces alongside sinking the wrapper above: the origin element's own ancestor chain
  // runs through the whole app shell (sidebar, main scroll area, page layout), any link of which
  // could be establishing its own stacking context this file has no visibility into — unlike the
  // modal's own short, single-level portal wrapper, which this hook fully controls. Directly
  // lifting the origin itself covers that case too, so whichever side actually decides the
  // ordering, the origin ends up on top either way. Restored once the hold window ends.
  // (Once at a time: a second landing within the hold would otherwise take the lifted values as the ones to go back to,
  // leaving it lifted for good.)
  if (el.dataset.popArrivalLift === undefined) {
    el.dataset.popArrivalLift = `${el.style.position}|${el.style.zIndex}`;
    if (getComputedStyle(el).position === "static") {
      el.style.position = "relative";
    }
    el.style.zIndex = "10000";
    window.setTimeout(() => {
      const [previousPosition = "", previousZIndex = ""] = (el.dataset.popArrivalLift ?? "|").split("|");
      el.style.position = previousPosition;
      el.style.zIndex = previousZIndex;
      delete el.dataset.popArrivalLift;
    }, ORIGIN_ARRIVAL_HOLD_MS);
  }

  bounceOriginElement(el, dx, dy);
}

// A pop-up opened again before it had gone (still mounted): back above the page if its landing had sunk it behind
// (applyOriginArrival) — left there, it sat invisible behind the page, with no way to close it.
function restoreSunkPopup(panel: HTMLElement | null) {
  const wrapper = panel?.parentElement;
  if (!wrapper || wrapper.dataset.popArrivalZ === undefined) return;
  wrapper.style.zIndex = wrapper.dataset.popArrivalZ;
  delete wrapper.dataset.popArrivalZ;
}

// The nudge an origin element (a button) gives as a pop-up lands back in it: pushed a little the way the pop-up
// was travelling (dx, dy), then settling. Also used on its own — e.g. the bell, as a notification's corner pop-up
// shrinks back into it (components/global-app-tabs-bar.tsx).
export function bounceOriginElement(el: HTMLElement, dx: number, dy: number) {
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return;
  const nx = dx / distance;
  const ny = dy / distance;
  const BOUNCE_DURATION_MS = 380;
  // The bounce below overshoots past the origin element's own resting transform (half a pixel,
  // translated up to 2px) — an origin button living inside a tightly-fitted overflow:hidden
  // container (e.g. a bottom action bar sized exactly to its collapsed/expanded content, like
  // FloatingBarSlot in the project page) clips that overshoot at the container's own edge, which
  // reads as the bounce getting visibly cut off mid-motion rather than wobbling freely. Walking up
  // from the origin element (not including it) for the nearest ancestor whose COMPUTED overflow
  // actually clips, and lifting just that one constraint for the bounce's own duration, fixes this
  // generically for whatever container happens to be in the way — rather than threading a specific
  // wrapper ref through every possible call site (bottom bar, sidebar, anywhere else a
  // useGlassModalPopOrigin-driven popup's origin might live). Restores the exact previous inline
  // value afterward (usually "", letting the className's own rule take back over), not a hardcoded
  // "hidden" — some ancestors set this via inline style rather than a class.
  let clippingAncestor: HTMLElement | null = null;
  let node = el.parentElement;
  for (let depth = 0; depth < 6 && node && node !== document.body; depth += 1) {
    const computed = getComputedStyle(node);
    if (computed.overflow !== "visible" || computed.overflowX !== "visible" || computed.overflowY !== "visible") {
      clippingAncestor = node;
      break;
    }
    node = node.parentElement;
  }
  if (clippingAncestor) {
    const ancestor = clippingAncestor;
    const previousOverflow = ancestor.style.overflow;
    const previousOverflowX = ancestor.style.overflowX;
    const previousOverflowY = ancestor.style.overflowY;
    ancestor.style.overflow = "visible";
    ancestor.style.overflowX = "visible";
    ancestor.style.overflowY = "visible";
    window.setTimeout(() => {
      ancestor.style.overflow = previousOverflow;
      ancestor.style.overflowX = previousOverflowX;
      ancestor.style.overflowY = previousOverflowY;
    }, BOUNCE_DURATION_MS);
  }
  // A decaying spring wobble — push out, overshoot back PAST rest, a smaller correction, settle —
  // with a gentle scale squash/stretch riding along with the displacement, instead of a single
  // straight-line push-and-snap-back. The Web Animations API (not a CSS transition/transitionend
  // pair) is what makes the multi-point, non-monotonic path practical: a transition can only ever
  // interpolate straight toward one target, so getting an overshoot-past-center out of it meant
  // chaining two separate transitions end to end, which is exactly what read as rigid/directional
  // — one motion out, one motion back, nothing in between. `fill: "none"` (the default) means the
  // element simply reverts to its underlying (untouched) transform once this finishes, no cleanup
  // needed.
  // The squash and overshoot sized to the element: its edges move at most 1.5px in and 0.5px out whatever its size —
  // a plain percentage moved a wide list row's ends by many pixels (1% of 1,150px is over 11px).
  const box = el.getBoundingClientRect();
  const squeeze = (size: number) => Math.max(0.99, 1 - 3 / Math.max(size, 1));
  const overshoot = (size: number) => Math.min(1.004, 1 + 1 / Math.max(size, 1));
  el.animate(
    [
      { transform: "translate(0px, 0px) scale(1, 1)" },
      // Kept subtle: a 2px nudge and a little settle, not a wobble.
      { transform: `translate(${nx * 2}px, ${ny * 2}px) scale(${squeeze(box.width)}, ${squeeze(box.height)})`, offset: 0.26 },
      { transform: `translate(${-nx * 0.6}px, ${-ny * 0.6}px) scale(${overshoot(box.width)}, ${overshoot(box.height)})`, offset: 0.56 },
      { transform: `translate(${nx * 0.2}px, ${ny * 0.2}px) scale(1, 1)`, offset: 0.8 },
      { transform: "translate(0px, 0px) scale(1, 1)" },
    ],
    { duration: BOUNCE_DURATION_MS, easing: "ease-in-out" },
  );
}

// Ties the arrival moment to what's ACTUALLY on screen — polls the panel's live shrinking size
// every frame and fires once it's visually close to the origin's own box — rather than a flat
// setTimeout guess at the CSS transition's nominal `duration`. A flat timeout waits for the panel
// to be fully, exactly arrived before switching it behind the origin, which reads as "lands on top
// of the button, THEN disappears" — two distinct beats. Firing a little earlier, while the panel
// is still visibly mid-shrink and only close to (not yet exactly at) the origin's size, means the
// remaining bit of shrink motion plays out already-hidden behind the origin, reading as one
// continuous motion of sliding INTO it rather than landing ONTO it. Capped by maxDelayMs so this
// still fires even if the panel's rect never quite converges (rounding, a transition that got
// interrupted, etc).
function scheduleOriginArrival(
  panel: HTMLElement,
  targetWidth: number,
  targetHeight: number,
  originElRef: RefObject<HTMLElement | null> | undefined,
  dx: number,
  dy: number,
  maxDelayMs: number,
): () => void {
  if (!originElRef) return () => {};
  let cancelled = false;
  let rafId = 0;
  // 1.35x, not 1.0x — firing at exact convergence is the "lands then disappears" case this exists
  // to avoid; firing while there's still a visible bit of shrink left to play out is the point.
  // Width and height each, not the diagonal: a wide, short origin (a list row) has a diagonal far bigger than the
  // pop-up's own, so by the diagonal it "arrived" on the first frame — sinking behind the page before it had
  // shrunk at all, leaving just the row's bounce. Each side has to be near the target's (or smaller) instead.
  const closeEnoughWidth = targetWidth * 1.35;
  const closeEnoughHeight = targetHeight * 1.35;
  const deadline = performance.now() + maxDelayMs;
  const check = () => {
    if (cancelled) return;
    const rect = panel.getBoundingClientRect();
    if ((rect.width <= closeEnoughWidth && rect.height <= closeEnoughHeight) || performance.now() >= deadline) {
      const originEl = originElRef.current;
      if (originEl?.isConnected) {
        applyOriginArrival(panel, originEl, dx, dy);
      }
      return;
    }
    rafId = requestAnimationFrame(check);
  };
  rafId = requestAnimationFrame(check);
  return () => {
    cancelled = true;
    cancelAnimationFrame(rafId);
  };
}

// Returns whether the caller should still render the modal's portal JSX.
// Callers must gate their portal on this return value instead of their own
// `isOpen` state — it stays true for one extra beat after `isOpen` goes false
// so the close animation has a real, still-mounted panel to animate before it
// actually leaves the DOM.
export function useGlassModalPopOrigin(
  isOpen: boolean,
  origin: GlassModalOrigin,
  panelRef: RefObject<HTMLDivElement | null>,
  options?: GlassModalPopOriginOptions,
  // Optional — re-read fresh at close time, never captured once, so a caller can safely pass a
  // ref to a list-row-sourced button without risking a stale/unmounted element (see
  // applyOriginArrival's own comment). Omit entirely to leave this hook's behavior exactly as
  // it was before this param existed.
  originElRef?: RefObject<HTMLElement | null>,
): boolean {
  const duration = options?.duration ?? DEFAULT_DURATION_MS;
  const easing = options?.easing ?? "cubic-bezier(0.34, 1.56, 0.64, 1)";
  // Same shape/pace as the opening curve (matching x-control-points) but with
  // the overshoot removed (y1 taken back down to 1) — reads as the same speed
  // with no bounce, instead of a differently-paced ease-in.
  const closingEasing = options?.closingEasing ?? "cubic-bezier(0.34, 1, 0.64, 1)";
  const [shouldRender, setShouldRender] = useState(isOpen);
  const lastOriginRef = useRef<GlassModalOrigin>(origin);

  if (isOpen && !shouldRender) {
    // Adjust state during render (React's documented pattern for syncing
    // state to a prop change) so the panel mounts in the very same pass
    // `isOpen` flips true, instead of a one-frame-late extra render.
    setShouldRender(true);
  }

  useLayoutEffect(() => {
    // Refs are only ever written inside an effect (never during render) —
    // `origin` only changes in lockstep with `isOpen` (callers set both from
    // the same click handler), so it's in the dep array below and this stays
    // in sync without needing a render-time write.
    if (isOpen && origin) {
      lastOriginRef.current = origin;
    }
    const panel = panelRef.current;
    if (!panel) {
      // No mounted panel to animate — happens when this hook's own portal isn't the one
      // currently in the tree (e.g. a caller renders two of these for the same isOpen/origin
      // pair, one used in a fullscreen view and one in the default view, only one of which is
      // ever actually mounted at a time), or the panel unmounted (its whole view was navigated
      // away from) before this effect could run. If we're closing, there's nothing to animate,
      // but `shouldRender` must still drop to false now — otherwise this instance is stuck
      // reporting "open" forever, and the next time its own portal DOES mount (e.g. navigating
      // to the view that renders it) it appears fully visible with no way to close, since
      // nothing will ever re-run this effect without a fresh isOpen/origin change. Deferred via
      // setTimeout (rather than called inline) since React disallows synchronous setState calls
      // directly in an effect body — same pattern the "no origin" closing branch below already uses.
      if (!isOpen) {
        const noPanelTimeout = window.setTimeout(() => setShouldRender(false), 0);
        return () => window.clearTimeout(noPanelTimeout);
      }
      return;
    }
    const activeOrigin = lastOriginRef.current;

    if (isOpen) {
      restoreSunkPopup(panel);
      const backdrop = findGlassModalBackdrop(panel);
      if (backdrop) {
        backdrop.style.transition = "";
        backdrop.style.opacity = "";
      }
      if (!activeOrigin) return;
      const panelRect = panel.getBoundingClientRect();
      const originCenterX = activeOrigin.left + activeOrigin.width / 2;
      const originCenterY = activeOrigin.top + activeOrigin.height / 2;
      const panelCenterX = panelRect.left + panelRect.width / 2;
      const panelCenterY = panelRect.top + panelRect.height / 2;
      const dx = originCenterX - panelCenterX;
      const dy = originCenterY - panelCenterY;
      const scaleX = Math.max(activeOrigin.width / panelRect.width, 0.02);
      const scaleY = Math.max(activeOrigin.height / panelRect.height, 0.02);

      panel.style.transition = "none";
      panel.style.opacity = "1";
      panel.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
      void panel.offsetWidth;
      panel.style.transition = `transform ${duration}ms ${easing}`;
      panel.style.transform = "translate(0px, 0px) scale(1, 1)";

      const clearInlineStyles = () => {
        panel.style.transition = "";
        panel.style.transform = "";
        panel.style.opacity = "";
      };
      panel.addEventListener("transitionend", clearInlineStyles, { once: true });
      return () => panel.removeEventListener("transitionend", clearInlineStyles);
    }

    // Closing: animate the still-mounted panel back into its origin button
    // and fade the backdrop, then actually stop rendering once both finish.
    const backdrop = findGlassModalBackdrop(panel);
    if (backdrop) {
      backdrop.style.transition = `opacity ${duration}ms ease`;
      backdrop.style.opacity = "0";
    }
    if (!activeOrigin) {
      panel.style.transition = `opacity ${duration}ms ${closingEasing}`;
      panel.style.opacity = "0";
      const noOriginTimeout = window.setTimeout(() => setShouldRender(false), duration);
      return () => window.clearTimeout(noOriginTimeout);
    }
    const panelRect = panel.getBoundingClientRect();
    const originCenterX = activeOrigin.left + activeOrigin.width / 2;
    const originCenterY = activeOrigin.top + activeOrigin.height / 2;
    const panelCenterX = panelRect.left + panelRect.width / 2;
    const panelCenterY = panelRect.top + panelRect.height / 2;
    const dx = originCenterX - panelCenterX;
    const dy = originCenterY - panelCenterY;
    const scaleX = Math.max(activeOrigin.width / panelRect.width, 0.02);
    const scaleY = Math.max(activeOrigin.height / panelRect.height, 0.02);

    panel.style.transition = "none";
    panel.style.transform = "translate(0px, 0px) scale(1, 1)";
    panel.style.opacity = "1";
    void panel.offsetWidth;
    panel.style.transition = `transform ${duration}ms ${closingEasing}, opacity ${duration}ms ${closingEasing}`;
    panel.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
    panel.style.opacity = "0";

    const cancelArrival = scheduleOriginArrival(panel, activeOrigin.width, activeOrigin.height, originElRef, dx, dy, duration + 60);

    // Held open a bit past `duration` only when there's a real origin to arrive at — long enough
    // for the sunk-behind-the-button state above to actually be visible before unmounting.
    const timeout = window.setTimeout(() => setShouldRender(false), originElRef ? duration + ORIGIN_ARRIVAL_HOLD_MS : duration);
    return () => {
      cancelArrival();
      window.clearTimeout(timeout);
    };
  }, [isOpen, origin, duration, easing, closingEasing, panelRef, originElRef]);

  return shouldRender;
}

// A trimmed-down sibling of useGlassModalPopOrigin above, for a popup that has no button click to
// grow out of when it opens (it appears as a side effect of some other action — see the Initial
// Measure close-summary popup's own comment) and should just already be there, fully visible, with
// no entrance animation at all — but should still shrink INTO a specific on-screen element when
// closed, same as a normal one would.
//
// `origin` must be a FRESH measurement taken at the exact moment `isOpen` flips to false, not a
// value captured earlier and reused — unlike a normal click-to-open popup (open and close happen
// within the same brief interaction), this kind can sit open for a while, during which the page
// can scroll or the target element can otherwise move. Animating toward a stale rect visibly misses
// the target ("goes past it"). Callers should compute both `origin` and `isOpen: false` together,
// in the same state update, e.g.:
//   onClose={() => {
//     const rect = targetRef.current?.getBoundingClientRect();
//     setOrigin(rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null);
//     setIsOpen(false);
//   }}
export function useGlassModalShrinkOnClose(
  isOpen: boolean,
  origin: GlassModalOrigin,
  panelRef: RefObject<HTMLDivElement | null>,
  options?: Pick<GlassModalPopOriginOptions, "duration" | "closingEasing">,
  // Optional — same opt-in push-nudge as useGlassModalPopOrigin's own identical param (see
  // applyOriginArrival). Re-read fresh at close time, same as `origin` itself already must be
  // for this hook (see this hook's own top comment) — pass the SAME ref a caller re-measures
  // `origin` from in its onClose handler, not a value captured once.
  originElRef?: RefObject<HTMLElement | null>,
): boolean {
  const duration = options?.duration ?? DEFAULT_DURATION_MS;
  const closingEasing = options?.closingEasing ?? "cubic-bezier(0.34, 1, 0.64, 1)";
  const [shouldRender, setShouldRender] = useState(isOpen);

  if (isOpen && !shouldRender) {
    setShouldRender(true);
  }

  useLayoutEffect(() => {
    // Opening: deliberately does nothing — no grow-from-origin, no fade. The panel appears in
    // React's own normal mount position immediately, "already open." (Opened again before it had gone: back above the
    // page if its landing had sunk it behind — see applyOriginArrival.)
    if (isOpen) {
      restoreSunkPopup(panelRef.current);
      return;
    }

    const panel = panelRef.current;
    if (!panel) {
      const noPanelTimeout = window.setTimeout(() => setShouldRender(false), 0);
      return () => window.clearTimeout(noPanelTimeout);
    }

    const backdrop = findGlassModalBackdrop(panel);
    if (backdrop) {
      backdrop.style.transition = `opacity ${duration}ms ease`;
      backdrop.style.opacity = "0";
    }

    if (!origin) {
      panel.style.transition = `opacity ${duration}ms ${closingEasing}`;
      panel.style.opacity = "0";
      const noOriginTimeout = window.setTimeout(() => setShouldRender(false), duration);
      return () => window.clearTimeout(noOriginTimeout);
    }

    const panelRect = panel.getBoundingClientRect();
    const originCenterX = origin.left + origin.width / 2;
    const originCenterY = origin.top + origin.height / 2;
    const panelCenterX = panelRect.left + panelRect.width / 2;
    const panelCenterY = panelRect.top + panelRect.height / 2;
    const dx = originCenterX - panelCenterX;
    const dy = originCenterY - panelCenterY;
    const scaleX = Math.max(origin.width / panelRect.width, 0.02);
    const scaleY = Math.max(origin.height / panelRect.height, 0.02);

    // No opacity fade here (unlike the no-origin fallback above) — this popup shrinks straight
    // into its target, fully opaque the whole way, rather than also fading out on top of that.
    panel.style.transition = "none";
    panel.style.transform = "translate(0px, 0px) scale(1, 1)";
    void panel.offsetWidth;
    panel.style.transition = `transform ${duration}ms ${closingEasing}`;
    panel.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;

    const cancelArrival = scheduleOriginArrival(panel, origin.width, origin.height, originElRef, dx, dy, duration + 60);

    // Held open a bit past `duration` only when there's a real origin to arrive at — see
    // useGlassModalPopOrigin's identical comment on this same pattern.
    const timeout = window.setTimeout(() => setShouldRender(false), originElRef ? duration + ORIGIN_ARRIVAL_HOLD_MS : duration);
    return () => {
      cancelArrival();
      window.clearTimeout(timeout);
    };
  }, [isOpen, origin, duration, closingEasing, panelRef, originElRef]);

  return shouldRender;
}
