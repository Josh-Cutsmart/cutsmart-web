"use client";

// Searching a Kanban board (the Dashboard's — main or sub-status — and Leads'): slides the board over to
// the next column that has a matching card in it (the search already hides the rest), and gives that card
// a brief glow so it's easy to spot. Works off whichever board is on screen: its columns are
// [data-board-column], their cards [data-board-card-id], inside a [data-horizontal-swipe-scroll] scroller.
// Collapsed columns don't show their cards, so they're passed over.
//
// fromColumn: the column last shown (to go on to the next one, wrapping round), or -1 for the first.
// Returns the column shown, or -1 if nothing matches.
export function scrollBoardToSearchMatch(fromColumn = -1): number {
  if (typeof document === "undefined") return -1;
  const columns = Array.from(document.querySelectorAll<HTMLElement>("[data-board-column]")).filter(
    (column) => column.getBoundingClientRect().width > 0,
  );
  if (!columns.length) return -1;
  let target = -1;
  for (let step = 0; step < columns.length; step += 1) {
    const index = (fromColumn + 1 + step) % columns.length;
    if (columns[index].querySelector("[data-board-card-id]")) {
      target = index;
      break;
    }
  }
  if (target < 0) return -1;

  const column = columns[target];
  const scroller = column.closest<HTMLElement>('[data-horizontal-swipe-scroll="true"]');
  if (scroller) {
    const box = scroller.getBoundingClientRect();
    const rect = column.getBoundingClientRect();
    // Already fully in view (a wide screen): left where it is. Otherwise centred — which is also where a
    // phone's one-column-at-a-time board snaps to.
    if (rect.left < box.left || rect.right > box.right) {
      scroller.scrollBy({ left: rect.left + rect.width / 2 - (box.left + box.width / 2), behavior: "smooth" });
    }
  }
  const card = column.querySelector<HTMLElement>("[data-board-card-id] > *");
  card?.animate?.(
    [
      { boxShadow: "0 0 0 3px rgba(59, 130, 246, 0.9), 0 0 22px rgba(59, 130, 246, 0.55)" },
      { boxShadow: "0 0 0 0 rgba(59, 130, 246, 0), 0 0 0 rgba(59, 130, 246, 0)" },
    ],
    { duration: 1600, delay: 250, easing: "ease-out" },
  );
  return target;
}
