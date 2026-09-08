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
): boolean {
  const duration = options?.duration ?? 320;
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

    const timeout = window.setTimeout(() => setShouldRender(false), duration);
    return () => window.clearTimeout(timeout);
  }, [isOpen, origin, duration, easing, closingEasing, panelRef]);

  return shouldRender;
}
