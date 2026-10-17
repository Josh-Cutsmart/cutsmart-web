"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The floating action pill's button slot — first the Quote/Specifications windows' (projects/[projectId]/page.tsx),
// now also the Dashboard's sub-status bar: a button that pops in and out of a floating pill rather than the pill
// jumping to its new size.
//
// One slot inside the Quote/Specs floating action-button pill (Save/Reset/Send/Accepted Version/
// Client Portal) — membership varies with project/version state (Save and Reset only show for the
// live draft, Send hides once it's locked, etc.), which used to mean an instant, jarring pill-width
// jump every time a condition flipped. This turns that into a deliberate two-step animation instead
// of a plain `{visible && <button/>}` mount/unmount: shrinking pops the button THEN slides the pill
// shut around the gap it leaves; growing slides the pill open FIRST, then fades the new button in
// once there's actually room for it. Always stays mounted (never returns null) — a fully collapsed
// slot is zero-width and `overflow: hidden`, so it's already invisible and unclickable without
// needing to leave the DOM.
export function FloatingBarSlot({
  visible,
  children,
  orientation = "horizontal",
  bounceStyle,
}: {
  visible: boolean;
  children: ReactNode;
  // "vertical" collapses maxHeight instead of maxWidth — used when this slot sits in a stacked
  // list (Quote/Specifications' own mobile action sheet) instead of the default horizontal pill.
  orientation?: "horizontal" | "vertical";
  // Optional entrance bounce (mobileActionsBubbleStyle's own return value) for the mobile Actions
  // sheet's own buttons. Applied to the OUTERMOST div below (the one `removedFromFlow` toggles
  // `display: none` on), never to `wrapperRef`'s own overflow:hidden box one level in — that box is
  // sized tightly to the content's natural (untransformed) height/width to drive its OWN collapse/
  // expand transition, so any transform-based animation applied directly to it (or to a child inside
  // it) gets clipped the instant it moves past that box's own edge. An earlier version of this
  // instead wrapped a whole separate `<div>` AROUND `<FloatingBarSlot>` from the outside to dodge
  // that clipping — which avoided the clip, but that wrapper had no idea about `removedFromFlow` and
  // so never left flex layout the way THIS slot's own root div does, leaving a zero-height-but-
  // still-gap-contributing ghost item behind for every OTHER currently-hidden button and visibly
  // uneven gaps between whichever buttons happened to be visible. Taking the prop here instead keeps
  // `removedFromFlow` as the one, single source of truth for whether this slot participates in the
  // flex row/column's layout at all.
  bounceStyle?: CSSProperties;
}) {
  const [collapsed, setCollapsed] = useState(!visible);
  // Once a slot has FULLY collapsed (maxWidth finished animating to 0 — not the same moment
  // `collapsed` itself flips true), this pulls it out of the flex row's layout entirely via
  // `display: none`, so the parent pill/strip can go back to plain `gap` spacing (simple,
  // naturally symmetric) instead of each slot managing its own margin. `gap` only ever applies
  // BETWEEN actual participating flex items — a `display: none` slot contributes none on either
  // side of it, which a merely zero-width one still did on both, and a per-slot marginRight
  // couldn't either: margin has no idea whether IT happens to be the last VISIBLE slot in a row
  // whose true last member varies with state, so whichever slot ended up last always carried an
  // extra, asymmetric-looking trailing gap beyond the pill's own edge padding. Flipping this the
  // MOMENT `collapsed` does would skip the slide-shut transition outright (no time for the width
  // to animate before the element leaves the layout); growing reverses the order for the same
  // reason — rejoin the layout first, still at maxWidth 0, and only expand a tick after that.
  const [removedFromFlow, setRemovedFromFlow] = useState(!visible);
  // The pop plays as an independent, position:fixed ghost portaled to <body> (see the JSX below),
  // positioned at a snapshot of exactly where the real button sat on screen the instant it started
  // leaving. A portal is outside every ancestor's own box/overflow entirely, so its scale(1.1)
  // bulge can freely render past the real slot's edges — visually "escaping" the bar, on top of
  // whatever's there — without growing the slot's own box (an earlier fix, giving the box padding
  // headroom to avoid clipping the bulge, worked but visibly grew the bar) and without affecting
  // any ancestor's scrollable-overflow bookkeeping the way an in-flow transform still does (which
  // is what briefly flashed a scrollbar on the mobile bottom strip's own overflow-x-auto in an
  // even earlier version of this).
  const [poppingRect, setPoppingRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // The entrance's own equivalent of poppingRect above, for exactly the same reason: `wrapperRef`
  // below is overflow:hidden (needed to clip the width/height SLIDE itself), so a scale(1.12) bounce
  // played in-place there gets its edges cut off the instant the real button's own natural size gets
  // anywhere close to the wrapper's generous-but-finite 260px/200px ceiling (worst for a vertical
  // w-full mobile button, which has zero horizontal slack at all). Portaled to <body> for the same
  // "escapes every ancestor's box/overflow" reason poppingRect's own comment explains, and measured
  // from `contentRef` (the real button's own natural box), not the wrapper, so the pop plays at
  // EXACTLY the same size as it would un-clipped — matching Import from Quote/Mark for Confirmation's
  // own identical pop-in (specs-grid-editor.tsx), not a scaled-to-fit stand-in.
  const [poppingInRect, setPoppingInRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // Drives the child's own opacity, deliberately SEPARATE from `collapsed` above even though it
  // moves in lockstep with it — see the render below for why the actual fade needs a transition
  // rule that's constant across renders (never toggled to "none"), which in turn means its target
  // VALUE has to be controlled independently rather than reusing collapsed's own true/false
  // directly as that value.
  const [contentVisible, setContentVisible] = useState(visible);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const prevVisibleRef = useRef(visible);

  useEffect(() => {
    if (visible === prevVisibleRef.current) return;
    prevVisibleRef.current = visible;
    const timers: number[] = [];
    const rafs: number[] = [];
    if (visible) {
      // Growing: rejoin the flex row on one animation frame (still collapsed, maxWidth 0 — this
      // alone doesn't visibly move anything), then start the actual width transition on the NEXT
      // frame. This has to be a real double-rAF, not a guessed setTimeout delay: an element that
      // was `display: none` has no previous computed box AT ALL to animate from, the same way a
      // brand-new element wouldn't — the browser needs an actual PAINTED frame of "now in the
      // layout, still at maxWidth 0" to interpolate the following change from, and nothing about a
      // plain millisecond delay guarantees a real paint happened in between (this is what was
      // making the bar jump straight to its open width instead of sliding open). 300ms after that —
      // a real elapsed-time wait for the width transition's own known duration to finish, not a
      // "did this paint yet" concern, so a plain setTimeout is fine here — the content div is
      // already laid out at its own real, natural size (still opacity:0), safe to measure for the
      // pop-in ghost exactly like the shrink branch below measures wrapperRef before anything moves.
      // The real content only actually becomes visible once that ghost's own pop has finished
      // playing, same staggering the shrink branch already uses in reverse.
      rafs.push(requestAnimationFrame(() => {
        setRemovedFromFlow(false);
        rafs.push(requestAnimationFrame(() => {
          setCollapsed(false);
          timers.push(window.setTimeout(() => {
            const rect = contentRef.current?.getBoundingClientRect();
            if (!rect) {
              setContentVisible(true);
              return;
            }
            setPoppingInRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
            timers.push(window.setTimeout(() => {
              setPoppingInRect(null);
              // The ghost is ALREADY sitting at opacity:1/scale:1 (its own keyframe's end state) the
              // instant before it disappears — handing off to the real content via the normal
              // React-driven opacity:0 -> 1 + "opacity 200ms ease" transition (same rule the hide
              // path uses) would restart a fresh 200ms fade from 0, i.e. a real, visible dip back to
              // invisible right after the pop finishes, then a slower fade back in — the "flash away
              // and back" this is fixing. Snapping the real element to fully opaque with its
              // transition briefly disabled (classic "transition: none -> change -> force reflow ->
              // restore transition" sequence, same technique useGlassModalPopOrigin already uses
              // elsewhere in this file) makes the handoff invisible instead: by the time React's own
              // re-render applies contentVisible's normal opacity:1/transition style a moment later,
              // the DOM is already sitting at those exact same values, so it's a no-op repaint, not a
              // second animation.
              const el = contentRef.current;
              if (el) {
                el.style.transition = "none";
                el.style.opacity = "1";
                void el.offsetWidth;
                el.style.transition = "opacity 200ms ease";
              }
              setContentVisible(true);
            }, 380));
          }, 300));
        }));
      }));
    } else {
      // Shrinking: measure now (synchronously, before anything moves), then a tick later hide the
      // real button and spawn the ghost at that exact spot — a plain setTimeout is fine here since
      // the slot is already `display: block` with a real, already-painted width (never `none`), so
      // there's no equivalent "nothing to animate from" risk. Once the ghost's own pop has
      // finished, the real slot collapses (sliding the bar shut); only once THAT transition has
      // also had time to finish does the slot actually leave the layout (see removedFromFlow's own
      // comment above for why this can't happen any earlier).
      const rect = wrapperRef.current?.getBoundingClientRect();
      timers.push(window.setTimeout(() => {
        setContentVisible(false);
        if (rect) setPoppingRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      }, 0));
      timers.push(window.setTimeout(() => {
        setPoppingRect(null);
        setCollapsed(true);
      }, 180));
      timers.push(window.setTimeout(() => setRemovedFromFlow(true), 180 + 320));
    }
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      rafs.forEach((raf) => cancelAnimationFrame(raf));
    };
  }, [visible]);

  return (
    <>
      <div
        className={orientation === "vertical" ? "w-full" : undefined}
        style={{ display: removedFromFlow ? "none" : "block", ...(bounceStyle ?? {}) }}
      >
        <div
          ref={wrapperRef}
          className={
            orientation === "vertical"
              ? "w-full overflow-hidden transition-[max-height] duration-300 ease-in-out"
              : "overflow-hidden transition-[max-width] duration-300 ease-in-out"
          }
          style={orientation === "vertical" ? { maxHeight: collapsed ? 0 : 200 } : { maxWidth: collapsed ? 0 : 260 }}
        >
          {/* Plain opacity fade, unchanged from before the pop-in existed — still a CONSTANT
              transition rule (never toggled to/from "none") for the reason explained below. The
              actual POP (both directions) plays entirely on the separate portaled ghosts further
              down (poppingInRect/poppingRect) instead of on this in-flow div: it sits inside
              wrapperRef's own overflow:hidden box (needed to clip the width/height SLIDE itself),
              so a scale(1.12) bounce played directly here would get its own edges cut off — see
              poppingInRect's own comment. This div just needs to be invisible while its ghost plays,
              then plainly fade to/from visible around that. transition is a CONSTANT rule here
              (never toggled to/from "none", unlike an earlier version of this) — changing
              transition-property in the exact same style update as the value it's supposed to cover
              is a well-known case where browsers skip the animation outright, since there's no prior
              painted frame under the NEW rule to interpolate from; that was silently turning the
              fade into an instant snap. With the rule always active, only WHEN contentVisible itself
              flips (fully independent of this) needs to be timed right — see the effect above. */}
          <div ref={contentRef} style={{ opacity: contentVisible ? 1 : 0, transition: "opacity 200ms ease" }}>
            {children}
          </div>
        </div>
      </div>
      {poppingInRect && typeof document !== "undefined"
        ? createPortal(
            <div
              className="glass-bubble-pop pointer-events-none fixed"
              style={{ left: poppingInRect.left, top: poppingInRect.top, width: poppingInRect.width, height: poppingInRect.height, zIndex: 2000 }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
      {poppingRect && typeof document !== "undefined"
        ? createPortal(
            <div
              className="floating-bar-slot-pop pointer-events-none fixed"
              style={{ left: poppingRect.left, top: poppingRect.top, width: poppingRect.width, height: poppingRect.height, zIndex: 2000 }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
