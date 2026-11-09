// Phones: a Kanban board's columns snap to the middle of the screen as it's swiped (scroll-snap, the columns'
// snap-center) — but a fast fling can leave it resting between two columns, the browser having given up the snap partway
// through the glide. So once the board has come to rest — no finger on it, and no scrolling for a moment — if it isn't
// on a column, it glides onto the nearest. (Nothing on a computer: its board doesn't snap.)

const SETTLE_AFTER_MS = 140;
// Close enough to a column's place to count as on it.
const ON_COLUMN_PX = 2;

// Where the board would rest with each of its columns in the middle: the columns that snap (snap-center), not the hidden
// board (the Dashboard's main board while a column's sub-board is open, or the other way round — marked aria-hidden).
function columnRestingPlaces(container: HTMLElement): number[] {
  const box = container.getBoundingClientRect();
  const middle = box.left + container.clientLeft + container.clientWidth / 2;
  const max = container.scrollWidth - container.clientWidth;
  const places: number[] = [];
  container.querySelectorAll<HTMLElement>(".snap-center").forEach((column) => {
    if (column.closest('[aria-hidden="true"]')) return;
    if (getComputedStyle(column).scrollSnapAlign.includes("none")) return;
    const rect = column.getBoundingClientRect();
    if (rect.width <= 0) return;
    places.push(Math.min(max, Math.max(0, container.scrollLeft + rect.left + rect.width / 2 - middle)));
  });
  return places;
}

export function attachBoardSnapSettle(container: HTMLElement): () => void {
  let touching = false;
  let timer: number | null = null;
  const clearTimer = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  const settle = () => {
    timer = null;
    if (touching || getComputedStyle(container).scrollSnapType === "none") return;
    const places = columnRestingPlaces(container);
    if (!places.length) return;
    const now = container.scrollLeft;
    const nearest = places.reduce((best, place) => (Math.abs(place - now) < Math.abs(best - now) ? place : best), places[0]);
    if (Math.abs(nearest - now) <= ON_COLUMN_PX) return;
    container.scrollTo({ left: nearest, behavior: "smooth" });
  };
  const soon = () => {
    clearTimer();
    timer = window.setTimeout(settle, SETTLE_AFTER_MS);
  };
  const onScroll = () => {
    if (!touching) soon();
  };
  const onTouchStart = () => {
    touching = true;
    clearTimer();
  };
  const onTouchEnd = (event: TouchEvent) => {
    if (event.touches.length) return;
    touching = false;
    soon();
  };
  container.addEventListener("scroll", onScroll, { passive: true });
  container.addEventListener("touchstart", onTouchStart, { passive: true });
  container.addEventListener("touchend", onTouchEnd, { passive: true });
  container.addEventListener("touchcancel", onTouchEnd, { passive: true });
  return () => {
    clearTimer();
    container.removeEventListener("scroll", onScroll);
    container.removeEventListener("touchstart", onTouchStart);
    container.removeEventListener("touchend", onTouchEnd);
    container.removeEventListener("touchcancel", onTouchEnd);
  };
}
