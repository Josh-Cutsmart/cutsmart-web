"use client";

import { createPortal, flushSync } from "react-dom";
import { forwardRef, useImperativeHandle, useRef, useState, type RefObject } from "react";

// Reusable "grab and swing" drag-ghost effect, extracted from the Sales Items
// board so any draggable list (lead board cards, item library rows, etc.) can
// share it: a custom floating pill follows the cursor in place of the
// browser's native drag image, growing out of the dragged element on pick-up
// and tilting side-to-side (a pendulum "swing") as it's moved horizontally.
//
// A Kanban card (the Dashboard's and Leads' boards — anything inside a [data-board-card-id] wrapper)
// gets the whole card instead of the pill: a see-through copy of it, hanging from the cursor by its
// top edge with a slight tilt, lifted straight off the card's own spot and swinging the same way.

export type DragGhostContent = { label: string; color: string } | null;

type DragGhostHandle = {
  getEl: () => HTMLDivElement | null;
  // Where a dragged card's copy goes (filled and emptied directly — React never renders into it).
  getCardSlot: () => HTMLDivElement | null;
  setContent: (content: DragGhostContent) => void;
};

// A dragged card's copy: see-through (a "ghost" of the card), with a deeper shadow for the lift.
const CARD_GHOST_OPACITY = "0.85";
const CARD_GHOST_SHADOW = "0 18px 38px rgba(15, 23, 42, 0.28)";
// Its resting tilt, hanging from the cursor — the swing is added to it.
const CARD_TILT_DEG = 3;

const DragGhostPill = forwardRef<DragGhostHandle>(function DragGhostPill(_props, ref) {
  const [content, setContent] = useState<DragGhostContent>(null);
  const elRef = useRef<HTMLDivElement | null>(null);
  const cardSlotRef = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => ({ getEl: () => elRef.current, getCardSlot: () => cardSlotRef.current, setContent }), []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={elRef}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[2147483647]"
      style={{ opacity: 0, transition: "opacity 150ms ease-out", willChange: "transform" }}
    >
      {content ? (
        <div
          className="flex items-center gap-2 rounded-[10px] border px-3 py-2"
          style={{
            borderColor: "var(--glass-border)",
            backgroundColor: "var(--glass-modal-bg)",
            backdropFilter: "blur(12px) saturate(220%)",
            WebkitBackdropFilter: "blur(12px) saturate(220%)",
            boxShadow: "var(--shadow-glass)",
          }}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: content.color }} />
          <span className="whitespace-nowrap text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>{content.label}</span>
        </div>
      ) : null}
      <div ref={cardSlotRef} />
    </div>,
    document.body,
  );
});

// Where the ghost sits for a pointer at (x, y): hanging just below it, centred, tilted by its swing — a
// card also keeps its slight resting tilt.
function placeTransform(x: number, y: number, swingDeg: number, isCard: boolean): string {
  return `translate(${x}px, ${y}px) translate(-50%, 6px) rotate(${isCard ? CARD_TILT_DEG + swingDeg : swingDeg}deg)`;
}

// The swing: the pointer's sideways speed (px a frame) × 1.6, up to 18° either way — smoothed, so slow or
// uneven movement doesn't make it shake. The speed is averaged over a few frames (each frame keeps this
// much of the last), and the tilt eases this far toward it each frame.
const SWING_VELOCITY_KEEP = 0.7;
const SWING_EASE = 0.25;

export type DragGhostController = {
  ghostRef: RefObject<DragGhostHandle | null>;
  transparentImageRef: RefObject<HTMLDivElement | null>;
  // Call from onDragStart, after event.dataTransfer.setDragImage(transparentImageRef.current, 0, 0).
  // `originElId` is the id of the on-screen element the ghost should visibly
  // grow out of (the FLIP "pick-up" pop); falls back to growing in place if
  // that element can't be found.
  spawn: (event: { clientX: number; clientY: number }, originElId: string, content: { label: string; color: string }) => void;
  // Call from onDragEnd. landOnCardId: a board card's id — its copy then glides onto that card's own spot
  // (where it was dropped, or back where it started if the drag was cancelled) and hands over to it,
  // instead of fading out where it was let go.
  end: (landOnCardId?: string) => void;
  // For drags the hook can't see itself (a touch-driven drag never dispatches `dragover`): report
  // the pointer position each move — the ghost follows it (swinging as usual) and the board edge
  // auto-scroll below still runs.
  trackPointer: (clientX: number, clientY: number) => void;
};

// Board edge auto-scroll: while a card is being dragged, holding it against the left/right edge of
// the board's horizontal scroller steps the board one column in that direction, repeating while it
// stays there. Stepping a whole column (rather than a continuous crawl) matches the mobile board's
// one-column-per-screen snap layout. The scroller is the dragged card's own
// [data-horizontal-swipe-scroll] ancestor (both the Dashboard and Leads boards carry it).
const EDGE_ZONE_PX = 40;
const EDGE_DWELL_MS = 280;
const EDGE_REPEAT_MS = 700;

function createBoardEdgeAutoScroll() {
  let scroller: HTMLElement | null = null;
  let direction: -1 | 0 | 1 = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const step = (dir: -1 | 1) => {
    if (!scroller) return;
    const scRect = scroller.getBoundingClientRect();
    const columns = Array.from(scroller.querySelectorAll<HTMLElement>("[data-board-column]")).filter(
      (col) => col.getBoundingClientRect().width > 0,
    );
    if (!columns.length) return;
    const snaps = getComputedStyle(scroller).scrollSnapType.includes("mandatory");
    if (snaps) {
      // One column per screen: centre the column after/before the one currently nearest the middle.
      const mid = scRect.left + scRect.width / 2;
      let current = 0;
      let best = Infinity;
      columns.forEach((col, index) => {
        const rect = col.getBoundingClientRect();
        const distance = Math.abs(rect.left + rect.width / 2 - mid);
        if (distance < best) {
          best = distance;
          current = index;
        }
      });
      const target = columns[Math.max(0, Math.min(columns.length - 1, current + dir))];
      const rect = target.getBoundingClientRect();
      scroller.scrollBy({ left: rect.left + rect.width / 2 - mid, behavior: "smooth" });
      return;
    }
    // Several columns visible: bring the next column that's cut off on that side fully into view.
    const target =
      dir === 1
        ? columns.find((col) => col.getBoundingClientRect().right > scRect.right + 1)
        : [...columns].reverse().find((col) => col.getBoundingClientRect().left < scRect.left - 1);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    scroller.scrollBy({ left: dir === 1 ? rect.right - scRect.right + 12 : rect.left - scRect.left - 12, behavior: "smooth" });
  };

  const schedule = (delay: number) => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (!direction) return;
      step(direction);
      schedule(EDGE_REPEAT_MS);
    }, delay);
  };

  const stop = () => {
    clearTimer();
    direction = 0;
    scroller = null;
  };

  return {
    begin(originEl: HTMLElement | null) {
      stop();
      // Mobile/tablet boards only — desktop keeps its existing drag behaviour.
      if (!window.matchMedia("(max-width: 1023px)").matches) return;
      scroller = originEl?.closest<HTMLElement>('[data-horizontal-swipe-scroll="true"]') ?? null;
    },
    update(clientX: number) {
      if (!scroller || scroller.scrollWidth <= scroller.clientWidth + 1) return;
      const rect = scroller.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const right = Math.min(window.innerWidth, rect.right);
      const next: -1 | 0 | 1 = clientX <= left + EDGE_ZONE_PX ? -1 : clientX >= right - EDGE_ZONE_PX ? 1 : 0;
      if (next === direction) return;
      direction = next;
      if (next) schedule(EDGE_DWELL_MS);
      else clearTimer();
    },
    stop,
  };
}

// Native drag fires `dragover` almost immediately and continuously, often at
// essentially the same spot the drag started — cancelling the pickup
// animation on literally the first one of those (any dragover at all) meant
// the grow animation never survived long enough to be seen. Only cancel it
// once the cursor has genuinely moved away from the pickup point, so a slow/
// deliberate pickup still gets the full visible pop, while a real fast drag
// still switches to instant tracking without lag.
const DRAG_GHOST_MOVE_CANCEL_PX = 12;

export function useDragGhost(): DragGhostController {
  const ghostRef = useRef<DragGhostHandle>(null);
  const startPointRef = useRef({ x: 0, y: 0 });
  const growFrameRef = useRef<number | null>(null);
  const settleCleanupRef = useRef<(() => void) | null>(null);
  const transparentImageRef = useRef<HTMLDivElement | null>(null);
  // One edge auto-scroller per hook instance (lazy useState init, so it's created exactly once).
  const [edgeScroll] = useState(createBoardEdgeAutoScroll);
  // Whether the ghost is a card's copy (not the pill), and the timer that empties its slot after a drop.
  const isCardRef = useRef(false);
  const clearCardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A card's copy is gliding into place (end with landOnCardId) — a second end() (a drop, then the drag's
  // own end) leaves it to finish.
  const landingRef = useRef(false);
  // Finishes a landing at once (a new drag starting before it's done).
  const landingFinishRef = useRef<(() => void) | null>(null);
  // Bumped by each new drag, so a landing still waiting for the board to draw doesn't run on the next one.
  const landingTokenRef = useRef(0);
  // The pointer's latest position, and the swing — moved a frame at a time (swingFrameRef) while it's
  // still catching up with the pointer, then left alone until the pointer moves again.
  const pointerRef = useRef({ x: 0, y: 0 });
  const swingRef = useRef({ active: false, frameX: 0, velocity: 0, rotation: 0, raf: 0 });
  const swingFrameRef = useRef(() => {
    const swing = swingRef.current;
    swing.raf = 0;
    const ghost = ghostRef.current?.getEl();
    if (!ghost || !swing.active) return;
    const { x, y } = pointerRef.current;
    // The pick-up hasn't started yet — don't jump ahead of it.
    if (growFrameRef.current !== null) {
      swing.frameX = x;
      swing.raf = requestAnimationFrame(swingFrameRef.current);
      return;
    }
    const dx = x - swing.frameX;
    swing.frameX = x;
    swing.velocity = swing.velocity * SWING_VELOCITY_KEEP + dx * (1 - SWING_VELOCITY_KEEP);
    const target = Math.max(-18, Math.min(18, swing.velocity * 1.6));
    swing.rotation += (target - swing.rotation) * SWING_EASE;
    const settled = dx === 0 && Math.abs(swing.velocity) < 0.05 && Math.abs(swing.rotation) < 0.05;
    if (settled) {
      swing.velocity = 0;
      swing.rotation = 0;
    }
    ghost.style.transform = placeTransform(x, y, swing.rotation, isCardRef.current);
    if (!settled) swing.raf = requestAnimationFrame(swingFrameRef.current);
  });
  const startSwing = (x: number, y: number) => {
    if (swingRef.current.raf) cancelAnimationFrame(swingRef.current.raf);
    pointerRef.current = { x, y };
    swingRef.current = { active: true, frameX: x, velocity: 0, rotation: 0, raf: 0 };
  };
  // Follows the pointer — from native `dragover` (below) or a touch drag reporting it (trackPointer).
  const followRef = useRef((x: number, y: number) => {
    const ghost = ghostRef.current?.getEl();
    if (!ghost) return;
    edgeScroll.update(x);
    pointerRef.current = { x, y };
    if (growFrameRef.current !== null || settleCleanupRef.current) {
      const movedPx = Math.hypot(x - startPointRef.current.x, y - startPointRef.current.y);
      if (movedPx > DRAG_GHOST_MOVE_CANCEL_PX) {
        if (growFrameRef.current !== null) {
          cancelAnimationFrame(growFrameRef.current);
          growFrameRef.current = null;
        }
        if (settleCleanupRef.current) {
          settleCleanupRef.current();
          settleCleanupRef.current = null;
        }
        ghost.style.transition = "none";
        ghost.style.transformOrigin = isCardRef.current ? "50% 0" : "center";
      }
    }
    const swing = swingRef.current;
    if (swing.active && !swing.raf) swing.raf = requestAnimationFrame(swingFrameRef.current);
  });
  const dragOverListenerRef = useRef((event: DragEvent) => {
    if (event.clientX === 0 && event.clientY === 0) return;
    followRef.current(event.clientX, event.clientY);
  });

  const clearPendingGrow = () => {
    if (growFrameRef.current !== null) {
      cancelAnimationFrame(growFrameRef.current);
      growFrameRef.current = null;
    }
    if (settleCleanupRef.current) {
      settleCleanupRef.current();
      settleCleanupRef.current = null;
    }
  };

  const spawn: DragGhostController["spawn"] = (event, originElId, content) => {
    landingFinishRef.current?.();
    landingTokenRef.current += 1;
    landingRef.current = false;
    clearPendingGrow();
    startSwing(event.clientX, event.clientY);
    startPointRef.current = { x: event.clientX, y: event.clientY };
    const handle = ghostRef.current;
    if (!handle) return;
    if (clearCardTimerRef.current) {
      clearTimeout(clearCardTimerRef.current);
      clearCardTimerRef.current = null;
    }
    const originCard =
      typeof document !== "undefined"
        ? (document.getElementById(originElId)?.closest<HTMLElement>("[data-board-card-id]")?.firstElementChild as HTMLElement | null | undefined)
        : null;
    if (originCard) {
      spawnCard(event, originCard);
      return;
    }
    isCardRef.current = false;
    handle.getCardSlot()?.replaceChildren();
    flushSync(() => handle.setContent(content));
    const ghost = handle.getEl();
    if (!ghost) return;
    // Snap the ghost onto the origin element's box immediately, with no
    // transition — this part just needs to happen before paint, not animate.
    ghost.style.transition = "none";
    ghost.style.transformOrigin = "top left";
    ghost.style.transform = "none";
    const naturalRect = ghost.getBoundingClientRect();
    const originEl = typeof document !== "undefined" ? document.getElementById(originElId) : null;
    edgeScroll.begin(originEl);
    const originRect = originEl ? originEl.getBoundingClientRect() : naturalRect;
    const scaleX = naturalRect.width > 0 ? Math.max(originRect.width, 1) / naturalRect.width : 1;
    const scaleY = naturalRect.height > 0 ? Math.max(originRect.height, 1) / naturalRect.height : 1;
    ghost.style.transform = `translate(${originRect.left}px, ${originRect.top}px) scale(${scaleX}, ${scaleY})`;
    ghost.style.opacity = "1";
    // The actual grow-to-cursor transition is deferred to the next frame
    // instead of forced via offsetWidth in this same tick — dragstart also
    // has to synchronously hand the browser its native drag image/session,
    // and starting a CSS transition in that same contended tick is what made
    // the grow animation look laggy/stuttery. Giving it a clean frame of its
    // own fixes that. Settling (dropping the transition so `dragover`'s
    // per-frame rotation writes aren't fighting an active transition) waits
    // for the real `transitionend` event rather than a fixed timer, so it
    // can never cut the animation short and make it "snap"/compact early.
    growFrameRef.current = requestAnimationFrame(() => {
      growFrameRef.current = null;
      const liveGhost = ghostRef.current?.getEl();
      if (!liveGhost) return;
      liveGhost.style.transition = "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 150ms ease-out";
      liveGhost.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, 6px) scale(1)`;
      const onSettled = () => {
        liveGhost.style.transition = "none";
        liveGhost.style.transformOrigin = "center";
        liveGhost.removeEventListener("transitionend", onSettled);
        settleCleanupRef.current = null;
      };
      liveGhost.addEventListener("transitionend", onSettled, { once: true });
      settleCleanupRef.current = () => liveGhost.removeEventListener("transitionend", onSettled);
    });
    if (typeof document !== "undefined") {
      document.addEventListener("dragover", dragOverListenerRef.current, true);
    }
  };

  // A board card: a see-through copy of the whole card, first exactly over the card itself, then lifted
  // to hang from the cursor (top edge, tilted) with the same springy pick-up as the pill.
  const spawnCard = (event: { clientX: number; clientY: number }, card: HTMLElement) => {
    const handle = ghostRef.current;
    const ghost = handle?.getEl();
    const slot = handle?.getCardSlot();
    if (!handle || !ghost || !slot) return;
    isCardRef.current = true;
    flushSync(() => handle.setContent(null));
    const rect = card.getBoundingClientRect();
    const copy = card.cloneNode(true) as HTMLElement;
    copy.removeAttribute("id");
    copy.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    copy.style.width = `${rect.width}px`;
    copy.style.margin = "0";
    copy.style.opacity = CARD_GHOST_OPACITY;
    copy.style.boxShadow = CARD_GHOST_SHADOW;
    copy.style.cursor = "grabbing";
    slot.replaceChildren(copy);
    edgeScroll.begin(card);
    ghost.style.transition = "none";
    ghost.style.transformOrigin = "50% 0";
    ghost.style.transform = `translate(${rect.left + rect.width / 2}px, ${rect.top}px) translate(-50%, 0) rotate(0deg)`;
    ghost.style.opacity = "1";
    growFrameRef.current = requestAnimationFrame(() => {
      growFrameRef.current = null;
      const liveGhost = ghostRef.current?.getEl();
      if (!liveGhost) return;
      liveGhost.style.transition = "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 150ms ease-out";
      liveGhost.style.transform = placeTransform(event.clientX, event.clientY, 0, true);
      const onSettled = () => {
        liveGhost.style.transition = "none";
        liveGhost.removeEventListener("transitionend", onSettled);
        settleCleanupRef.current = null;
      };
      liveGhost.addEventListener("transitionend", onSettled, { once: true });
      settleCleanupRef.current = () => liveGhost.removeEventListener("transitionend", onSettled);
    });
    if (typeof document !== "undefined") {
      document.addEventListener("dragover", dragOverListenerRef.current, true);
    }
  };

  const end: DragGhostController["end"] = (landOnCardId) => {
    if (landingRef.current) return;
    clearPendingGrow();
    edgeScroll.stop();
    if (swingRef.current.raf) cancelAnimationFrame(swingRef.current.raf);
    swingRef.current = { active: false, frameX: 0, velocity: 0, rotation: 0, raf: 0 };
    if (typeof document !== "undefined") {
      document.removeEventListener("dragover", dragOverListenerRef.current, true);
    }
    const handle = ghostRef.current;
    const ghost = handle?.getEl();
    if (
      ghost &&
      isCardRef.current &&
      landOnCardId &&
      typeof window !== "undefined" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      landingRef.current = true;
      landCard(landOnCardId);
      return;
    }
    if (ghost) {
      ghost.style.transition = "opacity 150ms ease-out";
      ghost.style.opacity = "0";
    }
    handle?.setContent(null);
    // A card's copy goes once it has faded out.
    if (isCardRef.current) {
      if (clearCardTimerRef.current) clearTimeout(clearCardTimerRef.current);
      clearCardTimerRef.current = setTimeout(() => {
        clearCardTimerRef.current = null;
        ghostRef.current?.getCardSlot()?.replaceChildren();
      }, 160);
    }
  };

  // The card's copy glides from where it was let go onto the card itself — found once the board has
  // drawn it in its new spot (a couple of frames on) — straightening and turning solid on the way, then
  // the card shows again under it and the copy goes. The last match is the one on top (a Dashboard
  // sub-status board over the main board). No card to land on: it fades out as usual.
  const landCard = (cardId: string) => {
    const token = landingTokenRef.current;
    const fadeOut = () => {
      landingRef.current = false;
      const ghost = ghostRef.current?.getEl();
      if (ghost) {
        ghost.style.transition = "opacity 150ms ease-out";
        ghost.style.opacity = "0";
      }
      clearCardTimerRef.current = setTimeout(() => {
        clearCardTimerRef.current = null;
        ghostRef.current?.getCardSlot()?.replaceChildren();
      }, 160);
    };
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (token !== landingTokenRef.current) return;
        const ghost = ghostRef.current?.getEl();
        const slot = ghostRef.current?.getCardSlot();
        const copy = slot?.firstElementChild as HTMLElement | null;
        const wrappers = Array.from(document.querySelectorAll<HTMLElement>(`[data-board-card-id="${CSS.escape(cardId)}"]`));
        const wrapper = wrappers[wrappers.length - 1];
        const card = wrapper?.firstElementChild as HTMLElement | null;
        const rect = card?.getBoundingClientRect();
        if (!ghost || !wrapper || !card || !rect || !rect.width) {
          fadeOut();
          return;
        }
        wrapper.style.opacity = "0";
        const finish = () => {
          if (clearCardTimerRef.current) clearTimeout(clearCardTimerRef.current);
          clearCardTimerRef.current = null;
          landingFinishRef.current = null;
          wrapper.style.opacity = "";
          ghost.style.transition = "none";
          ghost.style.opacity = "0";
          ghostRef.current?.getCardSlot()?.replaceChildren();
          landingRef.current = false;
        };
        landingFinishRef.current = finish;
        ghost.style.transition = "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)";
        ghost.style.transform = `translate(${rect.left + rect.width / 2}px, ${rect.top}px) translate(-50%, 0px) rotate(0deg)`;
        if (copy) {
          copy.style.transition = "opacity 280ms ease, box-shadow 280ms ease";
          copy.style.opacity = "1";
          copy.style.boxShadow = getComputedStyle(card).boxShadow;
        }
        clearCardTimerRef.current = setTimeout(finish, 300);
      }),
    );
  };

  const trackPointer: DragGhostController["trackPointer"] = (clientX, clientY) => {
    followRef.current(clientX, clientY);
  };

  return { ghostRef, transparentImageRef, spawn, end, trackPointer };
}

// Renders the two portal-mounted pieces a drag ghost needs: the 1x1
// transparent element handed to setDragImage() (so the browser's own drag
// image never shows), and the floating swinging pill itself. Mount this once
// per useDragGhost() instance, anywhere in the tree.
export function DragGhostLayer({ controller }: { controller: DragGhostController }) {
  const { ghostRef, transparentImageRef } = controller;
  if (typeof document === "undefined") return null;
  return (
    <>
      {createPortal(
        <div
          ref={transparentImageRef}
          aria-hidden="true"
          style={{ position: "fixed", top: 0, left: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />,
        document.body,
      )}
      <DragGhostPill ref={ghostRef} />
    </>
  );
}
