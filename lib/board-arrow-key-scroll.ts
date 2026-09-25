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
// ANIMATION: hand-rolled via requestAnimationFrame rather than `scrollBy({behavior:"smooth"})` —
// confirmed during testing that the native smooth scroll can be a silent no-op (some browsers
// honor an OS/browser "reduce motion" preference by disabling it outright, with no error and no
// instant fallback; `behavior:"auto"` worked immediately in the exact same environment where
// `"smooth"` produced zero movement). Rolling it by hand also respects that same preference
// deliberately (falling back to an instant jump), rather than accidentally being silently broken
// by it.
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
  const ANIMATION_MS = 280;

  let isHovering = false;
  const onMouseEnter = () => {
    isHovering = true;
  };
  const onMouseLeave = () => {
    isHovering = false;
  };

  let activeAnimationId = 0;
  const animateScrollLeftBy = (delta: number) => {
    const prefersReducedMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      container.scrollLeft += delta;
      return;
    }
    const animationId = ++activeAnimationId;
    const startLeft = container.scrollLeft;
    const targetLeft = startLeft + delta;
    const startTime = performance.now();
    const step = (now: number) => {
      // A newer call (another key press mid-animation) has taken over — let it run instead of
      // fighting over scrollLeft with this now-stale one.
      if (animationId !== activeAnimationId) return;
      const t = Math.min(1, (now - startTime) / ANIMATION_MS);
      // Ease-out cubic — same "fast start, gentle settle" curve as the app's other slide
      // animations, reads as a natural momentum-scroll-style slide rather than a linear pan.
      const eased = 1 - Math.pow(1 - t, 3);
      container.scrollLeft = startLeft + (targetLeft - startLeft) * eased;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const scrollToRevealColumn = (direction: 1 | -1) => {
    const columns = Array.from(container.querySelectorAll<HTMLElement>("[data-board-column]"));
    if (!columns.length) return;
    const containerRect = container.getBoundingClientRect();
    const containerStyle = getComputedStyle(container);
    const paddingLeft = Number.parseFloat(containerStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(containerStyle.paddingRight) || 0;
    let target: HTMLElement | undefined;

    if (direction > 0) {
      const edge = containerRect.right - paddingRight;
      target = columns.find((col) => {
        const r = col.getBoundingClientRect();
        return r.left < edge - EPSILON_PX && r.right > edge + EPSILON_PX;
      });
      if (!target) {
        target = columns.find((col) => col.getBoundingClientRect().left >= edge - EPSILON_PX);
      }
      if (!target) return;
      const delta = target.getBoundingClientRect().right - edge;
      if (Math.abs(delta) > EPSILON_PX) animateScrollLeftBy(delta);
      return;
    }

    const edge = containerRect.left + paddingLeft;
    const reversed = [...columns].reverse();
    target = reversed.find((col) => {
      const r = col.getBoundingClientRect();
      return r.right > edge + EPSILON_PX && r.left < edge - EPSILON_PX;
    });
    if (!target) {
      target = reversed.find((col) => col.getBoundingClientRect().right <= edge + EPSILON_PX);
    }
    if (!target) return;
    const delta = target.getBoundingClientRect().left - edge;
    if (Math.abs(delta) > EPSILON_PX) animateScrollLeftBy(delta);
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

  container.addEventListener("mouseenter", onMouseEnter);
  container.addEventListener("mouseleave", onMouseLeave);
  document.addEventListener("keydown", onKeyDown);
  return () => {
    container.removeEventListener("mouseenter", onMouseEnter);
    container.removeEventListener("mouseleave", onMouseLeave);
    document.removeEventListener("keydown", onKeyDown);
  };
}
