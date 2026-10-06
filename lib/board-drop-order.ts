// Card order on the Kanban boards (Leads, Dashboard). Cards sit in date order (newest first) until
// someone drags one: a dropped card stays in the exact spot it was dropped in.
//
// Each card's place in its column is a number — lower sits higher. A card that has been dragged
// keeps its own stored number; one that hasn't uses its date (minus its timestamp, so newer is
// higher up). A dropped card gets a number halfway between its new neighbours', so nothing else in
// the column needs re-saving, and cards that have never been dragged keep slotting in by date.

export function boardSortKey(storedOrder: unknown, dateIso: unknown): number {
  if (typeof storedOrder === "number" && Number.isFinite(storedOrder)) return storedOrder;
  const ms = Date.parse(String(dateIso ?? ""));
  return Number.isFinite(ms) ? -ms : 0;
}

// The number for a card dropped between two neighbours — either can be missing, at the top or
// bottom of the column (or both, in an empty column).
export function boardOrderBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return -Date.now();
  if (before === null) return (after as number) - 60_000;
  if (after === null) return before + 60_000;
  return (before + after) / 2;
}

// Where a card dragged to `clientY` would land in a column: how many of the column's other cards
// sit above that point (each card counts as "above" once the pointer passes its middle). Cards are
// found by their data-board-card-id wrapper; the drop preview has none, so it never counts.
export function boardDropIndex(columnEl: Element, clientY: number, draggedId: string): number {
  const cards = Array.from(columnEl.querySelectorAll<HTMLElement>("[data-board-card-id]")).filter(
    (el) => el.dataset.boardCardId !== draggedId,
  );
  let index = 0;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (clientY > rect.top + rect.height / 2) index += 1;
    else break;
  }
  return index;
}

// A column's cards with the drop preview slotted in at `previewIndex` (counted among the cards other
// than the one being dragged). The dragged card itself stays where it is (faded) until it's dropped;
// a preview right where it already sits isn't shown, as dropping there changes nothing.
export function withBoardDropPreview<T extends { id: string }, N>(
  items: T[],
  draggedId: string,
  previewIndex: number | null,
  renderItem: (item: T) => N,
  renderPreview: () => N,
): N[] {
  const out: N[] = [];
  const ownIndex = items.findIndex((item) => item.id === draggedId);
  const showPreview = previewIndex !== null && previewIndex !== ownIndex;
  let othersSeen = 0;
  for (const item of items) {
    if (item.id !== draggedId) {
      if (showPreview && previewIndex === othersSeen) out.push(renderPreview());
      othersSeen += 1;
    }
    out.push(renderItem(item));
  }
  if (showPreview && previewIndex !== null && previewIndex >= othersSeen) out.push(renderPreview());
  return out;
}

// How a column's cards are ordered. "custom" is the order people drag them into (the default); the
// others are each user's own choice, per column (the sort button on the column) or for the whole board
// (the toolbar's Sort button, which overrides every column while it's set). See
// components/board-sort-menu.tsx.
export type BoardSortMode = "custom" | "oldest" | "newest" | "az" | "za";
export const BOARD_SORT_MODES: readonly BoardSortMode[] = ["custom", "oldest", "newest", "az", "za"];
export const BOARD_SORT_LABELS: Record<BoardSortMode, string> = {
  custom: "Custom order",
  oldest: "Oldest – Newest",
  newest: "Newest – Oldest",
  az: "A – Z",
  za: "Z – A",
};

export function normalizeBoardSortMode(value: unknown): BoardSortMode {
  return BOARD_SORT_MODES.includes(value as BoardSortMode) ? (value as BoardSortMode) : "custom";
}

export function normalizeBoardColumnSorts(value: unknown): Record<string, BoardSortMode> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, BoardSortMode> = {};
  for (const [column, mode] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeBoardSortMode(mode);
    if (normalized !== "custom") out[column] = normalized;
  }
  return out;
}

// What a board needs to know about a card to order it.
export type BoardCardSortInfo = { key: number; dateMs: number; name: string };

export function compareBoardCards(mode: BoardSortMode, a: BoardCardSortInfo, b: BoardCardSortInfo): number {
  let result = 0;
  if (mode === "oldest") result = a.dateMs - b.dateMs;
  else if (mode === "newest") result = b.dateMs - a.dateMs;
  else if (mode === "az") result = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  else if (mode === "za") result = b.name.localeCompare(a.name, undefined, { sensitivity: "base", numeric: true });
  return result || a.key - b.key;
}

export function sortBoardCards<T>(items: T[], mode: BoardSortMode, info: (item: T) => BoardCardSortInfo): T[] {
  const withInfo = items.map((item) => ({ item, info: info(item) }));
  withInfo.sort((a, b) => compareBoardCards(mode, a.info, b.info));
  return withInfo.map((entry) => entry.item);
}

// Where a card lands in a sorted (not custom-order) column: how many of the column's other cards
// sort ahead of it — so its preview shows where the sort will actually put it.
export function sortedBoardDropIndex<T extends { id: string }>(
  columnItems: T[],
  dragged: T,
  mode: BoardSortMode,
  info: (item: T) => BoardCardSortInfo,
): number {
  const draggedInfo = info(dragged);
  return columnItems.filter((item) => item.id !== dragged.id && compareBoardCards(mode, info(item), draggedInfo) < 0).length;
}

// The faded, dashed-outline look of the drop preview card.
export const BOARD_DROP_PREVIEW_STYLE = {
  opacity: 0.55,
  animation: "board-drop-preview-in 160ms ease-out",
  outline: "2px dashed rgba(255,255,255,0.9)",
  outlineOffset: 2,
  borderRadius: 16,
} as const;
