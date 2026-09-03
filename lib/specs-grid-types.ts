import { interpolateQuoteTemplateText } from "@/lib/quote-template-placeholders";

export type SpecsCellStyle = {
  bold?: boolean;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  fontSize?: number;
  bgColor?: string;
  textColor?: string;
  borderTop?: boolean;
  borderRight?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
  borderColor?: string;
  borderWidthPx?: number;
};

export type SpecsCell = {
  text: string;
  colSpan?: number;
  rowSpan?: number;
  style?: SpecsCellStyle;
  // When set, the cell renders this image (e.g. the company logo) scaled to fit the cell's full
  // width/height instead of its text — the underlying `text` is kept untouched so removing the
  // image restores whatever text was there before.
  imageUrl?: string;
};

export type SpecsRow = {
  id: string;
  heightPx: number;
  cells: (SpecsCell | null)[];
};

export type SpecsPageSize = "A3" | "A4" | "A5" | "Letter" | "Legal";

// A named span of whole rows that can be shown/hidden as a unit — created in the builder by
// highlighting rows and "Link"-ing them, then toggled per-project in the Specifications window via a
// checkbox. Always spans the full width of the sheet. Bounds are row indices (not pixels), kept in
// sync with row insert/remove the same way a merged cell's own span already is (see
// adjustGroupsForRowInsert/Remove below).
export type SpecsRowGroup = {
  id: string;
  name: string;
  startRow: number;
  endRow: number;
  hidden?: boolean;
};

// A group whose rows were entirely deleted (one at a time, via the row "-" button, or all at once)
// but is kept around so it can be dragged back into the sheet later — see removeRowWithArchive and
// restoreDeletedGroup. Optional/defaulted-to-[] everywhere (like an older grid's missing `groups`
// used to be) so existing stored grids don't need a migration.
export type SpecsDeletedRowGroup = {
  id: string;
  name: string;
  rows: SpecsRow[];
  // Internal bookkeeping only (see removeRowWithArchive) — which end of the group the FIRST deletion
  // came from, remembered so later deletions of the same group keep appending/prepending consistently
  // even once the group has shrunk to its last single row, where "top" and "bottom" are the same
  // index and can no longer be told apart from position alone.
  deletingFromTop?: boolean;
};

export type SpecsGrid = {
  pageSize: SpecsPageSize;
  columnWidths: number[];
  rows: SpecsRow[];
  groups: SpecsRowGroup[];
  deletedGroups?: SpecsDeletedRowGroup[];
};

export type SpecsGridSelection = {
  anchorRow: number;
  anchorCol: number;
  focusRow: number;
  focusCol: number;
};

export const DEFAULT_COL_WIDTH_PX = 120;
export const TARGET_STARTING_COL_WIDTH_PX = 50;
export const DEFAULT_ROW_HEIGHT_PX = 32;
export const MIN_COL_WIDTH_PX = 5;
export const MIN_ROW_HEIGHT_PX = 5;
export const DEFAULT_CELL_FONT_SIZE_PX = 12;
export const DEFAULT_BORDER_WIDTH_PX = 2;
export const MIN_BORDER_WIDTH_PX = 1;
export const MAX_BORDER_WIDTH_PX = 12;

// Physical paper dimensions, matching jsPDF's own built-in "a3"/"a4"/"a5"/"letter"/"legal" format
// names directly (lowercased) so the PDF builder can hand grid.pageSize straight to jsPDF with no
// translation table to keep in sync. Height is NOT used to constrain the grid — jspdf-autotable
// already paginates a tall table across as many pages as it needs, so only width matters here.
export const SPECS_PAGE_SIZES: Record<SpecsPageSize, { widthMm: number; heightMm: number }> = {
  A3: { widthMm: 297, heightMm: 420 },
  A4: { widthMm: 210, heightMm: 297 },
  A5: { widthMm: 148, heightMm: 210 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
  Legal: { widthMm: 215.9, heightMm: 355.6 },
};
export const SPECS_PAGE_MARGIN_MM = 24 / (72 / 25.4); // matches the PDF builder's own 24pt margin
export const MM_TO_PX = 96 / 25.4;

// The actual printable width for a page size, in the same px units cell/column widths are stored
// in — i.e. what the columns should sum to so the printed sheet fills the page with no shrinking or
// stretching needed.
export function getSpecsPageUsableWidthPx(pageSize: SpecsPageSize): number {
  const { widthMm } = SPECS_PAGE_SIZES[pageSize];
  return Math.round((widthMm - SPECS_PAGE_MARGIN_MM * 2) * MM_TO_PX);
}

export function genSpecsRowId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function genSpecsGroupId(): string {
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createEmptyCell(): SpecsCell {
  return { text: "" };
}

// Starts a new grid with as many ~100px-wide columns as it takes to exactly fill the selected
// sheet's printable width — not a fixed column count, so a bigger sheet (A3) naturally starts with
// more columns than a smaller one (A5), all still around the same visual width.
export function createEmptyGrid(rows = 100, pageSize: SpecsPageSize = "A4"): SpecsGrid {
  const usableWidthPx = getSpecsPageUsableWidthPx(pageSize);
  const cols = Math.max(1, Math.round(usableWidthPx / TARGET_STARTING_COL_WIDTH_PX));
  const baseWidth = Math.max(MIN_COL_WIDTH_PX, Math.floor(usableWidthPx / cols));
  const columnWidths = Array.from({ length: cols }, () => baseWidth);
  // Give the last column any rounding remainder so the columns sum to exactly the page's usable
  // width, rather than leaving a visible gap short of the sheet edge.
  columnWidths[cols - 1] += usableWidthPx - baseWidth * cols;
  return {
    pageSize,
    columnWidths,
    rows: Array.from({ length: rows }, () => ({
      id: genSpecsRowId(),
      heightPx: DEFAULT_ROW_HEIGHT_PX,
      cells: Array.from({ length: cols }, () => createEmptyCell()),
    })),
    groups: [],
  };
}

// Recomputes the column COUNT to match the new page size — "however many ~100px columns it takes
// to fill that sheet" — not just rescaling the existing columns' widths while keeping their count
// fixed (that left every sheet size stuck at whatever column count the grid started with). Existing
// columns/content are kept as-is up to the new count: extra columns are appended (via insertColumn,
// which already handles span bookkeeping) if the new sheet is wider, or removed from the end (via
// removeColumn, which auto-unmerges anything that would be orphaned) if it's narrower. Every column
// is then evenly re-sized to fill the new width exactly.
export function resizeGridToPageSize(grid: SpecsGrid, pageSize: SpecsPageSize): SpecsGrid {
  const usableWidthPx = getSpecsPageUsableWidthPx(pageSize);
  const targetCols = Math.max(1, Math.round(usableWidthPx / TARGET_STARTING_COL_WIDTH_PX));
  let working: SpecsGrid = { ...grid, pageSize };
  while (working.columnWidths.length < targetCols) {
    working = insertColumn(working, working.columnWidths.length);
  }
  while (working.columnWidths.length > targetCols && working.columnWidths.length > 1) {
    working = removeColumn(working, working.columnWidths.length - 1);
  }
  const colCount = working.columnWidths.length;
  const baseWidth = Math.max(MIN_COL_WIDTH_PX, Math.floor(usableWidthPx / colCount));
  const columnWidths = Array.from({ length: colCount }, () => baseWidth);
  columnWidths[colCount - 1] += usableWidthPx - baseWidth * colCount;
  return { ...working, columnWidths };
}

// `?? 1` alone isn't enough here — it only replaces null/undefined, not a stray NaN (or 0, or a
// negative value) that ended up stored on a cell from some earlier bug. Every width/height
// computation downstream (editor rendering, the border overlay, the PDF export) indexes arrays by
// `col + colSpan`/`row + rowSpan`, and a non-finite span silently turns that into `undefined`,
// propagating as a NaN CSS value with no clear error at the point it actually breaks. Since this is
// the one place every caller gets a cell's span from, guarding here fixes the whole class of bug
// regardless of how a bad value got into the data.
function sanitizeSpanValue(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.round(value) : 1;
}

export function getCellSpan(cell: SpecsCell | null | undefined): { rowSpan: number; colSpan: number } {
  return { rowSpan: sanitizeSpanValue(cell?.rowSpan), colSpan: sanitizeSpanValue(cell?.colSpan) };
}

// Runtime shape-guard for a value loaded from Firestore — a malformed/partial document (or a
// leftover value from a totally different feature) must never be allowed to crash the editor or
// the PDF builder. Returns null on anything that doesn't look like a well-formed grid.
export function normalizeSpecsGrid(raw: unknown): SpecsGrid | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  const columnWidths = candidate.columnWidths;
  const rows = candidate.rows;
  if (!Array.isArray(columnWidths) || columnWidths.length === 0) return null;
  if (!columnWidths.every((w) => typeof w === "number" && Number.isFinite(w) && w > 0)) return null;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const normalizedRows: SpecsRow[] = [];
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx += 1) {
    const rawRow = rows[rowIdx];
    if (!rawRow || typeof rawRow !== "object") return null;
    const row = rawRow as Record<string, unknown>;
    if (typeof row.id !== "string") return null;
    if (typeof row.heightPx !== "number" || !Number.isFinite(row.heightPx) || row.heightPx <= 0) return null;
    if (!Array.isArray(row.cells) || row.cells.length !== columnWidths.length) return null;
    const normalizedCells: (SpecsCell | null)[] = [];
    for (let colIdx = 0; colIdx < row.cells.length; colIdx += 1) {
      const rawCell = row.cells[colIdx];
      if (rawCell === null) {
        normalizedCells.push(null);
        continue;
      }
      if (!rawCell || typeof rawCell !== "object" || typeof (rawCell as Record<string, unknown>).text !== "string") {
        return null;
      }
      const cell = rawCell as SpecsCell;
      // Clamps a stored span so it can never reach past the grid's actual size from this cell's own
      // position — protects against a span left oversized by an earlier bug (before this session's
      // various merge-adjustment fixes landed), which would otherwise index colPrefixSums/rowTops
      // out of bounds downstream (editor rendering, the border overlay, the PDF export), producing a
      // NaN width/height with no clear error at the point it actually breaks. Builds a fresh object
      // rather than mutating the loaded data in place.
      const clampedRowSpan = typeof cell.rowSpan === "number" && rowIdx + cell.rowSpan > rows.length ? Math.max(1, rows.length - rowIdx) : cell.rowSpan;
      const clampedColSpan = typeof cell.colSpan === "number" && colIdx + cell.colSpan > columnWidths.length ? Math.max(1, columnWidths.length - colIdx) : cell.colSpan;
      normalizedCells.push(
        clampedRowSpan !== cell.rowSpan || clampedColSpan !== cell.colSpan
          ? { ...cell, rowSpan: clampedRowSpan, colSpan: clampedColSpan }
          : cell,
      );
    }
    normalizedRows.push({ id: row.id, heightPx: row.heightPx, cells: normalizedCells });
  }
  const pageSize =
    typeof candidate.pageSize === "string" && candidate.pageSize in SPECS_PAGE_SIZES
      ? (candidate.pageSize as SpecsPageSize)
      : "A4";
  // Groups are a nice-to-have, not structural — a malformed entry is just dropped rather than
  // rejecting an otherwise-valid grid over it.
  const rawGroups = Array.isArray(candidate.groups) ? candidate.groups : [];
  const groups: SpecsRowGroup[] = rawGroups.filter((g): g is SpecsRowGroup => {
    if (!g || typeof g !== "object") return false;
    const group = g as Record<string, unknown>;
    return (
      typeof group.id === "string" &&
      typeof group.name === "string" &&
      typeof group.startRow === "number" && Number.isFinite(group.startRow) &&
      typeof group.endRow === "number" && Number.isFinite(group.endRow)
    );
  });
  // Same leniency as groups above — a deleted group is recoverable convenience, not structural, so a
  // malformed entry is just dropped. Rows inside it aren't re-clamped the way live rows are (no
  // `rows.length`/column context to clamp a merge span against until it's actually restored), only
  // shape-checked enough to guarantee restoreDeletedGroup won't crash on it.
  const rawDeletedGroups = Array.isArray(candidate.deletedGroups) ? candidate.deletedGroups : [];
  const deletedGroups: SpecsDeletedRowGroup[] = rawDeletedGroups.filter((g): g is SpecsDeletedRowGroup => {
    if (!g || typeof g !== "object") return false;
    const group = g as Record<string, unknown>;
    return (
      typeof group.id === "string" &&
      typeof group.name === "string" &&
      Array.isArray(group.rows) &&
      group.rows.every((r) => {
        if (!r || typeof r !== "object") return false;
        const row = r as Record<string, unknown>;
        return typeof row.id === "string" && Array.isArray(row.cells) && row.cells.length === columnWidths.length;
      })
    );
  });
  return { pageSize, columnWidths: columnWidths as number[], rows: normalizedRows, groups, deletedGroups };
}

// A row carries no visible content when every one of its own cells has empty text, no image, no
// fill, and no border on any side. A row covered by an earlier row's merge (a null cell) or one that
// itself anchors a merge (rowSpan/colSpan > 1) is never considered empty — a merge is always a
// deliberate design choice, not something to second-guess by looking at a single cell in isolation.
function isSpecsRowVisuallyEmpty(row: SpecsRow): boolean {
  return row.cells.every((cell) => {
    if (!cell) return false;
    const { rowSpan, colSpan } = getCellSpan(cell);
    if (rowSpan > 1 || colSpan > 1) return false;
    if (cell.text && cell.text.trim() !== "") return false;
    if (cell.imageUrl) return false;
    const style = cell.style;
    if (style?.bgColor) return false;
    if (style?.borderTop || style?.borderRight || style?.borderBottom || style?.borderLeft) return false;
    return true;
  });
}

// Drops only the TRAILING run of empty rows — from the end of the sheet back to (but not including)
// the last row that actually has content — used when a project's own specs sheet is first cloned
// from the company's template (see resolveSpecsGridTokens) and again right before print/PDF export,
// so a template built on the default 100 starting rows doesn't carry 80+ unused rows past whatever
// was actually filled in and print as several blank extra pages. Deliberately leaves any EMPTY row
// that sits BETWEEN two rows with content untouched — an interior blank row is often a deliberate
// spacer between sections, not leftover template padding, and only the user should decide to remove
// one of those (e.g. via the row's own "-" button). If nothing in the sheet has content at all, the
// grid is returned unchanged rather than collapsed to nothing.
export function pruneEmptySpecsRows(grid: SpecsGrid): SpecsGrid {
  let lastContentRow = -1;
  for (let r = grid.rows.length - 1; r >= 0; r -= 1) {
    if (!isSpecsRowVisuallyEmpty(grid.rows[r])) {
      lastContentRow = r;
      break;
    }
  }
  if (lastContentRow === -1) return grid;
  let working = grid;
  for (let r = working.rows.length - 1; r > lastContentRow; r -= 1) {
    working = removeRow(working, r);
  }
  return working;
}

// Direct analogue of the old Univer-based resolveSpecsTemplateSnapshot — deep-clones the template,
// resolves every {{token}} in every cell's text against the current project's real data, and
// regenerates row ids so this becomes a genuinely independent copy, not a live-bound reference back
// to the template. Resolved exactly once, at the moment a project's own specs sheet is first cloned.
export function resolveSpecsGridTokens(template: SpecsGrid, replacements: Record<string, string>): SpecsGrid {
  const cloned = JSON.parse(JSON.stringify(template)) as SpecsGrid;
  for (const row of cloned.rows) {
    row.id = genSpecsRowId();
    for (const cell of row.cells) {
      if (cell && typeof cell.text === "string") {
        cell.text = interpolateQuoteTemplateText(cell.text, replacements);
      }
    }
  }
  for (const group of cloned.groups ?? []) {
    group.id = genSpecsGroupId();
  }
  return pruneEmptySpecsRows(cloned);
}

function normalizeSelectionRect(sel: SpecsGridSelection) {
  return {
    minRow: Math.min(sel.anchorRow, sel.focusRow),
    maxRow: Math.max(sel.anchorRow, sel.focusRow),
    minCol: Math.min(sel.anchorCol, sel.focusCol),
    maxCol: Math.max(sel.anchorCol, sel.focusCol),
  };
}

// A merge is only valid if every cell whose span touches the selection rectangle is FULLY contained
// within it — merging across a partial overlap with an existing merge would leave the grid in a
// structurally invalid state (a span pointing outside its own covered region).
export function canMergeSelection(grid: SpecsGrid, sel: SpecsGridSelection): boolean {
  const { minRow, maxRow, minCol, maxCol } = normalizeSelectionRect(sel);
  if (minRow === maxRow && minCol === maxCol) return false;
  // Check every real (anchor) cell in the WHOLE grid, not just within the rectangle — an anchor
  // sitting outside the selection can still have a span that reaches partway into it, which is just
  // as invalid a merge as one starting inside.
  for (let r = 0; r < grid.rows.length; r += 1) {
    for (let c = 0; c < grid.columnWidths.length; c += 1) {
      const cell = grid.rows[r]?.cells[c];
      if (!cell) continue;
      const { rowSpan, colSpan } = getCellSpan(cell);
      const spanMaxRow = r + rowSpan - 1;
      const spanMaxCol = c + colSpan - 1;
      const overlaps = r <= maxRow && spanMaxRow >= minRow && c <= maxCol && spanMaxCol >= minCol;
      if (!overlaps) continue;
      const fullyContained = r >= minRow && spanMaxRow <= maxRow && c >= minCol && spanMaxCol <= maxCol;
      if (!fullyContained) return false;
    }
  }
  return true;
}

export function mergeSelection(grid: SpecsGrid, sel: SpecsGridSelection): SpecsGrid {
  const { minRow, maxRow, minCol, maxCol } = normalizeSelectionRect(sel);
  const next: SpecsGrid = { pageSize: grid.pageSize, columnWidths: grid.columnWidths, groups: grid.groups, deletedGroups: grid.deletedGroups, rows: grid.rows.map((row) => ({ ...row, cells: [...row.cells] })) };
  const anchor = next.rows[minRow].cells[minCol] ?? createEmptyCell();
  next.rows[minRow].cells[minCol] = { ...anchor, rowSpan: maxRow - minRow + 1, colSpan: maxCol - minCol + 1 };
  for (let r = minRow; r <= maxRow; r += 1) {
    for (let c = minCol; c <= maxCol; c += 1) {
      if (r === minRow && c === minCol) continue;
      next.rows[r].cells[c] = null;
    }
  }
  return next;
}

export function unmergeCell(grid: SpecsGrid, row: number, col: number): SpecsGrid {
  const anchor = grid.rows[row]?.cells[col];
  if (!anchor) return grid;
  const { rowSpan, colSpan } = getCellSpan(anchor);
  if (rowSpan <= 1 && colSpan <= 1) return grid;
  const next: SpecsGrid = { pageSize: grid.pageSize, columnWidths: grid.columnWidths, groups: grid.groups, deletedGroups: grid.deletedGroups, rows: grid.rows.map((r) => ({ ...r, cells: [...r.cells] })) };
  next.rows[row].cells[col] = { ...anchor, rowSpan: 1, colSpan: 1 };
  for (let r = row; r < row + rowSpan; r += 1) {
    for (let c = col; c < col + colSpan; c += 1) {
      if (r === row && c === col) continue;
      next.rows[r].cells[c] = createEmptyCell();
    }
  }
  return next;
}

// ---- Row groups: named row spans a project can show/hide as a unit ----

// A row range can touch a vertically-merged cell without covering its full span — e.g. highlighting
// rows 5-6 when a cell anchored at row 5 actually spans rows 5-7. Grouping that range as-is would cut
// a merge in half. This expands the range to fully contain any cell whose rowSpan crosses one of its
// edges, repeating (a newly-included row could itself contain a merge crossing the new edge) until
// nothing more needs to move. Only rowSpan matters here — a row group always spans the full width, so
// colSpan is never relevant.
function expandRowRangeToFullyContainSpans(grid: SpecsGrid, startRow: number, endRow: number): { startRow: number; endRow: number } {
  let start = startRow;
  let end = endRow;
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < grid.rows.length; r += 1) {
      for (let c = 0; c < grid.columnWidths.length; c += 1) {
        const cell = grid.rows[r]?.cells[c];
        if (!cell) continue;
        const { rowSpan } = getCellSpan(cell);
        const spanMaxRow = r + rowSpan - 1;
        const overlaps = r <= end && spanMaxRow >= start;
        if (!overlaps) continue;
        if (r < start) { start = r; changed = true; }
        if (spanMaxRow > end) { end = spanMaxRow; changed = true; }
      }
    }
  }
  return { startRow: start, endRow: end };
}

export function createRowGroup(grid: SpecsGrid, startRow: number, endRow: number, name: string): SpecsGrid {
  const expanded = expandRowRangeToFullyContainSpans(grid, Math.min(startRow, endRow), Math.max(startRow, endRow));
  const group: SpecsRowGroup = { id: genSpecsGroupId(), name, ...expanded };
  return { ...grid, groups: [...grid.groups, group] };
}

// Extends an EXISTING group to also cover a highlighted row range, rather than creating a new
// group. Since a group is a single contiguous range (deliberately simpler than the old per-cell
// rectangle model), "adding" a row/range that isn't already adjacent grows the group to the union of
// both ranges (min of both starts, max of both ends) — any rows in between become part of the group
// too. This is the same tradeoff already accepted for row groups generally: a section is a contiguous
// block of the sheet, not a scattered set of arbitrary rows.
export function addRowsToGroup(grid: SpecsGrid, groupId: string, startRow: number, endRow: number): SpecsGrid {
  const target = grid.groups.find((g) => g.id === groupId);
  if (!target) return grid;
  const unionStart = Math.min(target.startRow, startRow, endRow);
  const unionEnd = Math.max(target.endRow, startRow, endRow);
  const expanded = expandRowRangeToFullyContainSpans(grid, unionStart, unionEnd);
  return { ...grid, groups: grid.groups.map((g) => (g.id === groupId ? { ...g, ...expanded } : g)) };
}

export function renameRowGroup(grid: SpecsGrid, groupId: string, name: string): SpecsGrid {
  return { ...grid, groups: grid.groups.map((g) => (g.id === groupId ? { ...g, name } : g)) };
}

export function setRowGroupHidden(grid: SpecsGrid, groupId: string, hidden: boolean): SpecsGrid {
  return { ...grid, groups: grid.groups.map((g) => (g.id === groupId ? { ...g, hidden } : g)) };
}

export function removeRowGroup(grid: SpecsGrid, groupId: string): SpecsGrid {
  return { ...grid, groups: grid.groups.filter((g) => g.id !== groupId) };
}

// A group saved before this expansion existed (or one that somehow still ended up cutting through a
// merge) is corrected here at read time rather than needing a data migration — every group's range is
// recomputed to fully contain any merge it partially overlaps. Callers that need to check whether a
// row belongs to / is hidden by a group should use this list, not `grid.groups` directly.
export function getExpandedRowGroups(grid: SpecsGrid): SpecsRowGroup[] {
  return grid.groups.map((g) => {
    const expanded = expandRowRangeToFullyContainSpans(grid, g.startRow, g.endRow);
    return expanded.startRow === g.startRow && expanded.endRow === g.endRow ? g : { ...g, ...expanded };
  });
}

export function findRowGroupForRow(groups: SpecsRowGroup[], row: number): SpecsRowGroup | undefined {
  return groups.find((g) => row >= g.startRow && row <= g.endRow);
}

// Keeps a group's range aligned with a row insert or removal, the same way a merged cell's own span
// already is: an insertion at-or-before the group's start shifts it; an insertion strictly inside its
// range grows it to include the new row. A removal shrinks or shifts symmetrically, and a group whose
// entire range is removed is dropped rather than left with an inverted range. Column insert/remove
// never needs to touch groups at all, since a row group has no column bounds to adjust.
function adjustGroupsForRowInsert(groups: SpecsRowGroup[], atIndex: number): SpecsRowGroup[] {
  return groups.map((g) => {
    if (atIndex <= g.startRow) return { ...g, startRow: g.startRow + 1, endRow: g.endRow + 1 };
    if (atIndex <= g.endRow) return { ...g, endRow: g.endRow + 1 };
    return g;
  });
}

function adjustGroupsForRowRemove(groups: SpecsRowGroup[], index: number): SpecsRowGroup[] {
  return groups
    .map((g) => {
      if (index < g.startRow) return { ...g, startRow: g.startRow - 1, endRow: g.endRow - 1 };
      if (index <= g.endRow) return { ...g, endRow: g.endRow - 1 };
      return g;
    })
    .filter((g) => g.endRow >= g.startRow);
}

export function insertRow(grid: SpecsGrid, atIndex: number): SpecsGrid {
  const colCount = grid.columnWidths.length;
  const newRow: SpecsRow = { id: genSpecsRowId(), heightPx: DEFAULT_ROW_HEIGHT_PX, cells: Array.from({ length: colCount }, () => createEmptyCell()) };
  const rows = grid.rows.map((r) => ({ ...r, cells: [...r.cells] }));
  // A span crossing the insertion point must grow by one row instead of leaving a gap or an
  // out-of-bounds overlap.
  for (let r = 0; r < atIndex; r += 1) {
    for (let c = 0; c < colCount; c += 1) {
      const cell = rows[r].cells[c];
      if (!cell) continue;
      const { rowSpan } = getCellSpan(cell);
      if (r < atIndex && atIndex < r + rowSpan) {
        rows[r].cells[c] = { ...cell, rowSpan: rowSpan + 1 };
        newRow.cells[c] = null;
      }
    }
  }
  rows.splice(atIndex, 0, newRow);
  return { pageSize: grid.pageSize, columnWidths: grid.columnWidths, rows, groups: adjustGroupsForRowInsert(grid.groups, atIndex), deletedGroups: grid.deletedGroups };
}

// Inserts a BLANK templated copy of `index`'s own row directly below it — same cell style/colSpan/
// row height (borders, fills, alignment, merges), but never the source's actual text/image content.
// The point is a repeatable "next line item" row that already looks right, not a clone of whatever
// data happened to be typed into the row it came from. Reuses insertRow's own span-crossing-the-
// insertion-point handling (a merge reaching down from an earlier row correctly grows and covers the
// new row too) rather than duplicating that logic here — this only decides what goes into the new
// row's OWN previously-empty cells once insertRow has placed it.
export function duplicateRowAsBlankTemplate(grid: SpecsGrid, index: number): SpecsGrid {
  const source = grid.rows[index];
  if (!source) return grid;
  const inserted = insertRow(grid, index + 1);
  const newRowIndex = index + 1;
  const rows = inserted.rows.map((r, ri) => {
    if (ri !== newRowIndex) return r;
    const cells = r.cells.map((existingCell, c) => {
      // insertRow already decided this position is covered by a merge reaching down from an earlier
      // row — copying the source's own styling there would create an invalid overlapping span.
      if (existingCell === null) return null;
      const sourceCell = source.cells[c];
      // Covered by the SOURCE row's own colSpan merge — mirror that here too, rather than filling it
      // with an unrelated empty cell that would visually break the duplicated merge in half.
      if (sourceCell === null) return null;
      const { colSpan } = getCellSpan(sourceCell);
      // A vertical (rowSpan) merge never carries over — duplicating a merge's anchor row should
      // produce a plain, unmerged template of its style, not try to continue that merge one row
      // further down into content that has nothing to do with it. Text and any image are dropped
      // entirely — only the LOOK of the row (style) is a "template" here, not its data.
      return { text: "", style: sourceCell.style, rowSpan: 1, colSpan };
    });
    return { ...r, heightPx: source.heightPx, cells };
  });
  return { ...inserted, rows };
}

export function removeRow(grid: SpecsGrid, index: number): SpecsGrid {
  if (grid.rows.length <= 1) return grid;
  const colCount = grid.columnWidths.length;
  let working = grid;
  // Any anchor starting on the row being removed would otherwise silently lose its content along
  // with any cells it covers — unmerge it first so those covered cells become plain empty cells the
  // splice below can safely remove just the one row from.
  for (let c = 0; c < colCount; c += 1) {
    const cell = working.rows[index]?.cells[c];
    if (cell) {
      const { rowSpan, colSpan } = getCellSpan(cell);
      if (rowSpan > 1 || colSpan > 1) working = unmergeCell(working, index, c);
    }
  }
  const rows = working.rows.map((r) => ({ ...r, cells: [...r.cells] }));
  for (let r = 0; r < index; r += 1) {
    for (let c = 0; c < colCount; c += 1) {
      const cell = rows[r].cells[c];
      if (!cell) continue;
      const { rowSpan } = getCellSpan(cell);
      if (r < index && index < r + rowSpan) {
        rows[r].cells[c] = { ...cell, rowSpan: rowSpan - 1 };
      }
    }
  }
  rows.splice(index, 1);
  return { pageSize: working.pageSize, columnWidths: working.columnWidths, rows, groups: adjustGroupsForRowRemove(working.groups, index), deletedGroups: working.deletedGroups };
}

// The UI-facing "delete this row" action (the row's own "-" button, in a project's own copy) —
// removeRow itself stays a plain, archive-free primitive since it's also used internally by
// pruning/merge-adjustment/restoreDeletedGroup, where archiving would be surprising (pruning 80
// unused template rows silently filing them away as a "deleted group" nobody asked to keep).
//
// If the row being removed belongs to a group, it's archived into deletedGroups (keyed by that
// group's own id) BEFORE the removal — so even if a user empties an entire multi-row group one row
// at a time, every row that ever belonged to it survives and the group stays fully restorable via
// restoreDeletedGroup. Ordering within the archive is inferred from which end of the group the FIRST
// deletion came from (its startRow vs endRow at that moment) and remembered on the archive entry
// itself (`deletingFromTop`) — deleting consistently from the top or consistently from the bottom, by
// far the two realistic ways someone empties a section, reconstructs the original top-to-bottom order
// either way, INCLUDING the final row, where the group has shrunk to just one and startRow/endRow are
// the same index — position alone can no longer tell top from bottom at that point, which is exactly
// why the direction is decided once (on the first deletion) and reused rather than re-derived every
// time. Deleting from the middle first falls back to append order, which won't perfectly preserve
// original order in that specific (uncommon) case.
export function removeRowWithArchive(grid: SpecsGrid, index: number): SpecsGrid {
  const row = grid.rows[index];
  if (!row) return grid;
  const owner = findRowGroupForRow(getExpandedRowGroups(grid), index);
  let working = grid;
  if (owner) {
    const existing = (working.deletedGroups ?? []).find((g) => g.id === owner.id);
    const archivedRows = existing ? [...existing.rows] : [];
    const deletingFromTop = existing?.deletingFromTop ?? !(index === owner.endRow && index !== owner.startRow);
    if (deletingFromTop) archivedRows.push(row);
    else archivedRows.unshift(row);
    const others = (working.deletedGroups ?? []).filter((g) => g.id !== owner.id);
    working = { ...working, deletedGroups: [...others, { id: owner.id, name: owner.name, rows: archivedRows, deletingFromTop }] };
  }
  return removeRow(working, index);
}

// Drags a fully-deleted group (see removeRowWithArchive) back into the sheet at `atRowIndex`, as a
// brand-new group covering its full original row count there. Reuses insertRow's own span-crossing-
// the-insertion-point handling (an existing merge reaching across `atRowIndex` correctly grows to
// cover the newly-inserted rows too) by inserting blank rows one at a time and then overwriting them
// with the archived content, rather than a raw splice that would have to reimplement that.
export function restoreDeletedGroup(grid: SpecsGrid, deletedGroupId: string, atRowIndex: number): SpecsGrid {
  const archived = (grid.deletedGroups ?? []).find((g) => g.id === deletedGroupId);
  if (!archived || archived.rows.length === 0) return grid;
  const insertAt = Math.max(0, Math.min(atRowIndex, grid.rows.length));
  let working = grid;
  for (let i = 0; i < archived.rows.length; i += 1) {
    working = insertRow(working, insertAt + i);
  }
  const rows = working.rows.map((r, ri) => {
    if (ri < insertAt || ri >= insertAt + archived.rows.length) return r;
    return archived.rows[ri - insertAt];
  });
  const group: SpecsRowGroup = { id: archived.id, name: archived.name, startRow: insertAt, endRow: insertAt + archived.rows.length - 1, hidden: false };
  const deletedGroups = (working.deletedGroups ?? []).filter((g) => g.id !== deletedGroupId);
  return { ...working, rows, groups: [...working.groups, group], deletedGroups };
}

// Reorders an EXISTING group's rows to start at `targetIndex`, keeping every row inside it — and
// everything outside it — in the same relative order otherwise. Implemented as "cut the group's rows
// out, then splice them back in elsewhere": `mapIndex` mirrors that exact same transformation for every
// OTHER row/group's own indices, so nothing else's bounds drift out of sync with where its rows
// actually ended up. A drop that would land inside (or immediately adjacent to, which is a no-op
// either way) the group's own current span is rejected rather than silently doing nothing useful.
export function moveRowGroup(grid: SpecsGrid, groupId: string, targetIndex: number): SpecsGrid {
  const group = getExpandedRowGroups(grid).find((g) => g.id === groupId);
  if (!group) return grid;
  const { startRow: start, endRow: end } = group;
  const blockLen = end - start + 1;
  const insertAt = Math.max(0, Math.min(targetIndex, grid.rows.length));
  if (insertAt > start && insertAt <= end + 1) return grid;
  const block = grid.rows.slice(start, end + 1);
  const withoutBlock = [...grid.rows.slice(0, start), ...grid.rows.slice(end + 1)];
  const adjustedInsertAt = insertAt > end ? insertAt - blockLen : insertAt;
  const rows = [...withoutBlock.slice(0, adjustedInsertAt), ...block, ...withoutBlock.slice(adjustedInsertAt)];
  const mapIndex = (idx: number): number => {
    if (idx >= start && idx <= end) return adjustedInsertAt + (idx - start);
    let afterRemoval = idx > end ? idx - blockLen : idx;
    if (afterRemoval >= adjustedInsertAt) afterRemoval += blockLen;
    return afterRemoval;
  };
  // mapIndex already handles the moved group's own rows (the `idx >= start && idx <= end` branch)
  // correctly, so every group — including this one — goes through the exact same transform; no
  // special-casing needed here.
  const groups = grid.groups.map((g) => ({ ...g, startRow: mapIndex(g.startRow), endRow: mapIndex(g.endRow) }));
  return { ...grid, rows, groups };
}

export function insertColumn(grid: SpecsGrid, atIndex: number): SpecsGrid {
  const columnWidths = [...grid.columnWidths];
  columnWidths.splice(atIndex, 0, DEFAULT_COL_WIDTH_PX);
  const rows = grid.rows.map((row) => {
    const cells = [...row.cells];
    let inserted: SpecsCell | null = createEmptyCell();
    for (let c = 0; c < atIndex; c += 1) {
      const cell = cells[c];
      if (!cell) continue;
      const { colSpan } = getCellSpan(cell);
      if (c < atIndex && atIndex < c + colSpan) {
        cells[c] = { ...cell, colSpan: colSpan + 1 };
        inserted = null;
      }
    }
    cells.splice(atIndex, 0, inserted);
    return { ...row, cells };
  });
  return { pageSize: grid.pageSize, columnWidths, rows, groups: grid.groups, deletedGroups: grid.deletedGroups };
}

export function removeColumn(grid: SpecsGrid, index: number): SpecsGrid {
  if (grid.columnWidths.length <= 1) return grid;
  let working = grid;
  for (let r = 0; r < working.rows.length; r += 1) {
    const cell = working.rows[r].cells[index];
    if (cell) {
      const { rowSpan, colSpan } = getCellSpan(cell);
      if (rowSpan > 1 || colSpan > 1) working = unmergeCell(working, r, index);
    }
  }
  const columnWidths = [...working.columnWidths];
  columnWidths.splice(index, 1);
  const rows = working.rows.map((row) => {
    const cells = [...row.cells];
    for (let c = 0; c < index; c += 1) {
      const cell = cells[c];
      if (!cell) continue;
      const { colSpan } = getCellSpan(cell);
      if (c < index && index < c + colSpan) {
        cells[c] = { ...cell, colSpan: colSpan - 1 };
      }
    }
    cells.splice(index, 1);
    return { ...row, cells };
  });
  return { pageSize: working.pageSize, columnWidths, rows, groups: working.groups, deletedGroups: working.deletedGroups };
}
