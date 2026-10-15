// Shared Left/Right arrow-key handler for a horizontally-scrolling kanban board (used by both the
// Dashboard board/sub-board and the Leads board — same column markup convention:
// `[data-board-column]` children of the horizontal scroll container).
//
// Replaces the browser's own default keyboard-scroll behavior (a small, arbitrary increment —
// fires whenever a focused descendant, e.g. a card's tabIndex=0 div, is inside an overflow-x-auto
// ancestor) with "jump to fully reveal whichever column is currently only half showing at that
// edge": on ArrowRight, find the column currently straddling the container's own right edge (its
// left edge is inside the container, its right edge isn't) and scroll just enough to bring that
// column's right edge flush with the container's own padding edge (see PADDING below) — nothing
// more, nothing less. ArrowLeft mirrors this against the left edge. If no column is currently
// straddling that edge (a "clean" boundary — every visible column already fits exactly, or
// scrolled all the way to one end), falls back to revealing the very next column not yet visible
// at all, same alignment.
//
// PADDING: the container has its own CSS padding (`px-[10px]`, `lg:px-4`) — a column resting at
// either scroll extreme already sits inset from the container's true edge by that amount, not
// flush against it. Landing a jump flush against the bare edge (ignoring padding) would leave the
// column sitting tighter against the boundary than it ever does at rest, on every OTHER side.
// Measured from the container's own computed style rather than hardcoded, so it stays correct
// whichever padding class is actually active at the current breakpoint.
//
// ANIMATION: the browser's own smooth scroll (`scrollTo({behavior:"smooth"})`) — the same slide the
// arrow keys give when the board isn't handling them. The browser runs it apart from the page's own
// work, so it stays smooth while the board repaints under it. It used to be stepped by hand from
// requestAnimationFrame, setting scrollLeft every frame — that waits on the page each frame, and with
// the pointer over the board (cards repainting their hover as they pass under it) whole frames went
// missing, so it jumped to the next column rather than sliding. (An earlier note here said the smooth
// scroll could be a silent no-op — that was a hidden test window, which plays no animation at all.)
// A key pressed while a slide's still under way carries on from where it's headed — one more column
// per press, the browser retargeting it mid-glide. A press on the board or a sideways wheel scroll
// takes over from it.
//
// FOCUS: listens on `document`, not the container itself — an earlier version attached to the
// container and relied on the key event bubbling up from whichever descendant had focus (e.g. a
// card's own tabIndex=0 div). That only works if the user happened to click an actual card first;
// a column with no cards in it ("No projects.") has nothing focusable at all, so clicking anywhere
// in an empty column left focus wherever it was before, and arrow keys never reached the container
// to begin with. Listening globally and gating on "is the board itself currently in play" — the
// pointer is over it, OR focus already happens to be somewhere inside it — covers both a bare
// hover (no click needed at all) and the original click-a-card case, without requiring either
// specifically.
export function attachBoardArrowKeyScroll(container: HTMLElement): () => void {
  const EPSILON_PX = 2;
  // Longest a slide could take — in case it's cut short without a scrollend to say so.
  const SLIDE_SAFETY_MS = 1200;

  let isHovering = false;
  const onMouseEnter = () => {
    isHovering = true;
  };
  const onMouseLeave = () => {
    isHovering = false;
  };

  // Where a slide still under way is headed (null when none is) — a key pressed mid-slide works from there.
  let slideTargetLeft: number | null = null;
  let slideSafetyTimer = 0;
  const endSlide = () => {
    slideTargetLeft = null;
    window.clearTimeout(slideSafetyTimer);
  };
  const slideScrollLeftTo = (targetLeft: number) => {
    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    slideTargetLeft = Math.min(maxLeft, Math.max(0, targetLeft));
    window.clearTimeout(slideSafetyTimer);
    slideSafetyTimer = window.setTimeout(endSlide, SLIDE_SAFETY_MS);
    container.scrollTo({ left: slideTargetLeft, behavior: "smooth" });
  };
  // It's landed (scrollend, or — where there's no scrollend — the scroll reaching it).
  const onScroll = () => {
    if (slideTargetLeft !== null && Math.abs(container.scrollLeft - slideTargetLeft) < 1) endSlide();
  };

  const scrollToRevealColumn = (direction: 1 | -1) => {
    const columns = Array.from(container.querySelectorAll<HTMLElement>("[data-board-column]"));
    if (!columns.length) return;
    // Measured as the board will be once a slide under way lands (the columns shifted by what's left of it), so
    // a press mid-slide reveals the column after the one already sliding in, not that one again.
    const baseLeft = slideTargetLeft ?? container.scrollLeft;
    const pending = baseLeft - container.scrollLeft;
    const rectOf = (col: HTMLElement) => {
      const r = col.getBoundingClientRect();
      return { left: r.left - pending, right: r.right - pending };
    };
    const containerRect = container.getBoundingClientRect();
    const containerStyle = getComputedStyle(container);
    const paddingLeft = Number.parseFloat(containerStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(containerStyle.paddingRight) || 0;
    let target: HTMLElement | undefined;

    if (direction > 0) {
      const edge = containerRect.right - paddingRight;
      target = columns.find((col) => {
        const r = rectOf(col);
        return r.left < edge - EPSILON_PX && r.right > edge + EPSILON_PX;
      });
      if (!target) {
        target = columns.find((col) => rectOf(col).left >= edge - EPSILON_PX);
      }
      if (!target) return;
      const delta = rectOf(target).right - edge;
      if (Math.abs(delta) > EPSILON_PX) slideScrollLeftTo(baseLeft + delta);
      return;
    }

    const edge = containerRect.left + paddingLeft;
    const reversed = [...columns].reverse();
    target = reversed.find((col) => {
      const r = rectOf(col);
      return r.right > edge + EPSILON_PX && r.left < edge - EPSILON_PX;
    });
    if (!target) {
      target = reversed.find((col) => rectOf(col).right <= edge + EPSILON_PX);
    }
    if (!target) return;
    const delta = rectOf(target).left - edge;
    if (Math.abs(delta) > EPSILON_PX) slideScrollLeftTo(baseLeft + delta);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // Never steal arrow keys from an actual text field elsewhere on the page (e.g. a search box).
    const targetTag = (e.target as HTMLElement | null)?.tagName;
    if (targetTag === "INPUT" || targetTag === "TEXTAREA") return;
    // Only take over when the board is genuinely "in play" right now — the pointer is currently
    // over it, or focus already happens to be somewhere inside it (a card clicked earlier, even if
    // the mouse has since moved away) — never for an arrow key that's unrelated to the board
    // entirely (elsewhere on the page, a modal open on top of it, etc.).
    if (!isHovering && !container.contains(document.activeElement)) return;
    e.preventDefault();
    scrollToRevealColumn(e.key === "ArrowRight" ? 1 : -1);
  };

  // A press on the board (a drag-scroll starting) or a sideways wheel scroll takes over from a slide under way (the
  // browser stops its own slide for them) — so the next key press works from wherever the board then is.
  const onWheel = (e: WheelEvent) => {
    if (slideTargetLeft !== null && (e.deltaX !== 0 || e.shiftKey)) endSlide();
  };

  container.addEventListener("mouseenter", onMouseEnter);
  container.addEventListener("mouseleave", onMouseLeave);
  container.addEventListener("pointerdown", endSlide);
  container.addEventListener("wheel", onWheel, { passive: true });
  container.addEventListener("scroll", onScroll, { passive: true });
  container.addEventListener("scrollend", endSlide);
  document.addEventListener("keydown", onKeyDown);
  return () => {
    endSlide();
    container.removeEventListener("mouseenter", onMouseEnter);
    container.removeEventListener("mouseleave", onMouseLeave);
    container.removeEventListener("pointerdown", endSlide);
    container.removeEventListener("wheel", onWheel);
    container.removeEventListener("scroll", onScroll);
    container.removeEventListener("scrollend", endSlide);
    document.removeEventListener("keydown", onKeyDown);
  };
}
