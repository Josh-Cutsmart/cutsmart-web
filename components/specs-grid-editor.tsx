"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import {
  Bold,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  Image as ImageIcon,
  ImageOff,
  Plus,
  Minus,
  Trash2,
  X,
  Copy,
  ClipboardPaste,
  Link2,
  Link2Off,
  Eye,
  EyeOff,
  GripVertical,
  Undo2,
} from "lucide-react";
import {
  type SpecsGrid,
  type SpecsGridSelection,
  type SpecsCellStyle,
  type SpecsCell,
  type SpecsRow,
  type SpecsRowGroup,
  type SpecsPageSize,
  getCellSpan,
  canMergeSelection,
  mergeSelection,
  unmergeCell,
  insertRow,
  removeRow,
  removeRowWithArchive,
  restoreDeletedGroup,
  moveRowGroup,
  duplicateRowAsBlankTemplate,
  insertColumn,
  removeColumn,
  resizeGridToPageSize,
  createRowGroup,
  addRowsToGroup,
  renameRowGroup,
  setRowGroupHidden,
  removeRowGroup,
  getExpandedRowGroups,
  findRowGroupForRow,
  SPECS_PAGE_SIZES,
  SPECS_PAGE_MARGIN_MM,
  MM_TO_PX,
  MIN_COL_WIDTH_PX,
  MIN_ROW_HEIGHT_PX,
  DEFAULT_COL_WIDTH_PX,
  DEFAULT_ROW_HEIGHT_PX,
  DEFAULT_CELL_FONT_SIZE_PX,
  DEFAULT_BORDER_WIDTH_PX,
  MIN_BORDER_WIDTH_PX,
  MAX_BORDER_WIDTH_PX,
} from "@/lib/specs-grid-types";
import { SpecsCellColorPopover, type SpecsColorPopoverAnchorRect } from "@/components/specs-cell-color-popover";

export type SpecsGridEditorProps = {
  value: SpecsGrid;
  onChange: (next: SpecsGrid) => void;
  className?: string;
  // Only the company template builder should be able to change the sheet's paper size — a project's
  // own cloned copy just inherits whatever the template used.
  showPageSizeSelector?: boolean;
  // When provided, enables the "Insert Logo" toolbar button, which drops this URL into the active
  // cell so it renders scaled to fit that cell instead of text.
  companyLogoUrl?: string;
  // When provided, adds the company's brand color as an extra swatch in the Fill/Border color pickers.
  companyColor?: string;
  // Marks this instance as a PROJECT'S OWN copy of the sheet rather than the company template
  // builder — switches the editor into a read/print-oriented presentation mode on top of its
  // original, narrower purpose (a show/hide checklist for the grid's named row groups, created via
  // right-click → "Link Rows as Group" on either version — a hidden group's rows are fully skipped,
  // not just dimmed, whenever this is on). When true, the editor also: hides the row-number/
  // column-letter headers, disables drag-to-resize (both would invite restructuring a layout the
  // template already fixed), hides the default gridlines (only borders someone explicitly drew show,
  // like a real printed sheet), and stops drawing a group's name as a floating label over the sheet
  // itself (it's already shown once, in the checklist this prop adds above the sheet). The company
  // template builder leaves this unset, since it's actively laying the sheet out, not reading it.
  showGroupVisibilityPanel?: boolean;
};

function normalizeRect(sel: SpecsGridSelection) {
  return {
    minRow: Math.min(sel.anchorRow, sel.focusRow),
    maxRow: Math.max(sel.anchorRow, sel.focusRow),
    minCol: Math.min(sel.anchorCol, sel.focusCol),
    maxCol: Math.max(sel.anchorCol, sel.focusCol),
  };
}

function isCellInRect(row: number, col: number, rect: { minRow: number; maxRow: number; minCol: number; maxCol: number }) {
  return row >= rect.minRow && row <= rect.maxRow && col >= rect.minCol && col <= rect.maxCol;
}

type CellRect = { minRow: number; maxRow: number; minCol: number; maxCol: number };

// Grows a selection rect to fully cover any merged cell it only partially touches — clicking a
// merged cell's anchor produces a plain 1x1 selection at that single (row, col) position, which
// covers only the merge's own top-left slot unless expanded to its real rowSpan/colSpan extent.
// Repeats (a newly-included cell could itself be part of a wider/taller merge) until nothing more
// needs to move — the same fixed-point approach already used for row groups' own span expansion.
function expandRectForMergedSpans(grid: SpecsGrid, rect: CellRect): CellRect {
  let { minRow, maxRow, minCol, maxCol } = rect;
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < grid.rows.length; r += 1) {
      for (let c = 0; c < grid.columnWidths.length; c += 1) {
        const cell = grid.rows[r]?.cells[c];
        if (!cell) continue;
        const { rowSpan, colSpan } = getCellSpan(cell);
        const spanMaxRow = r + rowSpan - 1;
        const spanMaxCol = c + colSpan - 1;
        const overlaps = r <= maxRow && spanMaxRow >= minRow && c <= maxCol && spanMaxCol >= minCol;
        if (!overlaps) continue;
        if (r < minRow) { minRow = r; changed = true; }
        if (spanMaxRow > maxRow) { maxRow = spanMaxRow; changed = true; }
        if (c < minCol) { minCol = c; changed = true; }
        if (spanMaxCol > maxCol) { maxCol = spanMaxCol; changed = true; }
      }
    }
  }
  return { minRow, maxRow, minCol, maxCol };
}

// Reuses the same align/verticalAlign fields text cells use — a cell holds either text or an
// image, never both, so there's no conflict. Unlike text (which defaults to left/top), an
// unpositioned image defaults to centered, since that reads best for a logo placed in a cell
// larger than it needs.
function imageObjectPositionFor(style: SpecsCellStyle): string {
  const horizontal = style.align === "left" ? "left" : style.align === "right" ? "right" : "center";
  const vertical = style.verticalAlign === "top" ? "top" : style.verticalAlign === "bottom" ? "bottom" : "center";
  return `${horizontal} ${vertical}`;
}

// Finds whichever cell actually occupies (row, col) visually — the cell stored directly there, or
// (if that position is null, i.e. covered by an earlier anchor's colSpan) the anchor reached by
// scanning backward within the same row. A plain index lookup at a covered position returns null,
// which silently hides a wide merged cell from a neighboring row's own border-sharing checks —
// exactly why a merged cell's border used to look cut off after its first column. Doesn't chase
// rowSpan coverage reaching down from an earlier row — narrower than a full grid search, but covers
// the common horizontal-merge case these neighbor lookups need.
function findRowAnchorCell(row: SpecsRow | undefined, col: number): SpecsCell | null {
  if (!row || col < 0) return null;
  for (let c = col; c >= 0; c -= 1) {
    const candidate = row.cells[c];
    if (candidate) {
      const { colSpan } = getCellSpan(candidate);
      return c + colSpan - 1 >= col ? candidate : null;
    }
  }
  return null;
}

// A cell's own border flag on one side and its neighbor's flag on the touching side (e.g. my
// borderBottom vs. the cell below's borderTop) are stored independently — so the edge should render
// whenever EITHER side turned it on, not only when the cell being drawn happens to own the flag.
// Mine wins if both are set (arbitrary but consistent tiebreak for color/width).
function resolveBorderSide(
  mineOn: boolean | undefined,
  mineColor: string | undefined,
  mineWidth: number | undefined,
  neighborOn: boolean | undefined,
  neighborColor: string | undefined,
  neighborWidth: number | undefined,
): { color: string; width: number } | null {
  if (mineOn) return { color: mineColor ?? "#000000", width: mineWidth ?? DEFAULT_BORDER_WIDTH_PX };
  if (neighborOn) return { color: neighborColor ?? "#000000", width: neighborWidth ?? DEFAULT_BORDER_WIDTH_PX };
  return null;
}

// Explicit borders are rendered as a SEPARATE overlay of solid rectangles positioned on top of the
// whole table, rather than per-cell box-shadow. Reason: even with a single, correctly-resolved owner
// cell per edge (see below), that owner is still just one `<td>` among many siblings — and a LATER
// sibling cell's own plain 1px gridline (a real `border-*`, not a box-shadow) always paints AFTER an
// EARLIER cell's box-shadow, per normal in-flow paint order. Wherever a vertical gridline crossed a
// horizontal explicit-border band, the later-painted gridline showed through as a small notch,
// cutting the border into segments. An absolutely-positioned overlay is a POSITIONED sibling of the
// `<table>` itself, which — regardless of z-index — always paints after all of the table's own
// normal-flow content (background/borders/box-shadow of every cell), so nothing from any cell can
// ever paint on top of it.
//
// Each shared edge still resolves to exactly ONE owner — the earlier cell in reading order, checking
// both its own flag and the later cell's opposite flag (so toggling "Bottom" on the upper cell or
// "Top" on the lower cell both produce the same single line) — except the grid's own outer top/left
// edge (row 0 / column 0), which has no earlier cell to delegate to. `findRowAnchorCell` (not a raw
// index lookup) means this stays correct against a wider/narrower merged neighbor too: every column
// a wide merge spans independently discovers that same covering cell, even from a position the merge
// only covers rather than anchors.
type BorderSegment = { left: number; top: number; width: number; height: number; color: string };

function computeBorderSegments(grid: SpecsGrid, colPrefixSums: number[], rowTops: number[], hiddenRowIndexes: Set<number>): BorderSegment[] {
  const segments: BorderSegment[] = [];
  const maxColIdx = colPrefixSums.length - 1;
  const maxRowIdx = rowTops.length - 1;
  for (let r = 0; r < grid.rows.length; r += 1) {
    // Deliberately NOT skipping a hidden row entirely as a border owner here — a hidden row whose
    // neighbor is still VISIBLE is exactly the "trailing divider row" case: its own bottom/top
    // position collapses to zero height, so whatever border its VISIBLE neighbor wants still lands
    // correctly at the seam where the hidden content used to be. What DOES need gating, per cell
    // below, is which SIDE'S OWN style is allowed to actually produce a border — a hidden row's own
    // border property must never draw (regardless of whether the far side is visible or hidden), and
    // a visible row's own border property must always draw (regardless of the far side's state). See
    // `ownRowVisible` below.
    const row = grid.rows[r];
    const ownRowVisible = !hiddenRowIndexes.has(r);
    for (let c = 0; c < grid.columnWidths.length; c += 1) {
      const cell = row.cells[c];
      if (!cell) continue;
      const { rowSpan, colSpan } = getCellSpan(cell);
      const style = cell.style ?? {};
      // getCellSpan only guarantees a finite positive integer, not that it actually fits within the
      // grid's current size from this cell's position — a stored span that outgrew the grid (e.g.
      // from an earlier bug, before this session's various merge-adjustment fixes) would otherwise
      // index colPrefixSums/rowTops out of bounds, producing `undefined` and a NaN width/height.
      // Clamping here means such a cell just visually caps at the grid's edge instead of crashing.
      const left = colPrefixSums[c];
      const right = colPrefixSums[Math.min(c + colSpan, maxColIdx)];
      const top = rowTops[r];
      const bottom = rowTops[Math.min(r + rowSpan, maxRowIdx)];

      if (r === 0 && ownRowVisible && style.borderTop) {
        const width = style.borderWidthPx ?? DEFAULT_BORDER_WIDTH_PX;
        segments.push({ left, top, width: right - left, height: width, color: style.borderColor ?? "#000000" });
      }
      if (c === 0 && ownRowVisible && style.borderLeft) {
        const width = style.borderWidthPx ?? DEFAULT_BORDER_WIDTH_PX;
        segments.push({ left, top, width, height: bottom - top, color: style.borderColor ?? "#000000" });
      }
      // Ownership-aware, not just adjacency-aware: this cell's own borderBottom only counts while its
      // OWN row is visible, and the neighbor's borderTop only counts while THAT row is visible —
      // independently of each other. A border between a hidden row and a visible one therefore always
      // resolves to whichever side is actually visible (if either), rather than a blanket "hide
      // whenever either side is hidden" or "keep whenever either side is visible" rule — either of
      // which is provably wrong in some direction: a still-visible row's own explicit border must
      // always show regardless of what's hidden on the other side (it's that row's own decoration),
      // while a hidden row's own border must never show even if it happens to face a visible
      // neighbor that simply doesn't specify a border of its own.
      const belowNeighbor = findRowAnchorCell(grid.rows[r + rowSpan], c);
      const belowNeighborVisible = !hiddenRowIndexes.has(r + rowSpan);
      const bottomResolved = resolveBorderSide(
        ownRowVisible && style.borderBottom,
        style.borderColor,
        style.borderWidthPx,
        belowNeighborVisible && belowNeighbor?.style?.borderTop,
        belowNeighbor?.style?.borderColor,
        belowNeighbor?.style?.borderWidthPx,
      );
      if (bottomResolved) {
        // When every row before this one has collapsed to zero height (this cell's own row is
        // hidden and sits right at the start of the table), `bottom` can be smaller than the
        // border's own width, pushing `top` negative — off the top edge of the scrollable area and
        // therefore invisible even though the border is otherwise correctly meant to show here (as
        // the resumed visible content's own leading edge). Clamp to 0 so it still renders, flush
        // against the table's actual top.
        segments.push({ left, top: Math.max(0, bottom - bottomResolved.width), width: right - left, height: bottomResolved.width, color: bottomResolved.color });
      }
      const rightNeighbor = findRowAnchorCell(grid.rows[r], c + colSpan);
      const rightResolved = resolveBorderSide(
        ownRowVisible && style.borderRight,
        style.borderColor,
        style.borderWidthPx,
        ownRowVisible && rightNeighbor?.style?.borderLeft,
        rightNeighbor?.style?.borderColor,
        rightNeighbor?.style?.borderWidthPx,
      );
      if (rightResolved) {
        segments.push({ left: right - rightResolved.width, top, width: rightResolved.width, height: bottom - top, color: rightResolved.color });
      }
    }
  }
  return segments;
}

type GroupOutline = { id: string; name: string; hidden: boolean; top: number; height: number };

// One full-width horizontal band per row group, from the same rowTops used for the border overlay —
// rendered as a dashed outline + label so it's clear which rows a group covers, in both the builder
// (where groups are created) and a project's own copy (where they're only shown/hidden). Takes an
// already-expanded groups list (getExpandedRowGroups) so the outline never cuts through a merge.
// Width/left are the table's own full width, applied by the caller — row groups always span it.
function computeGroupOutlines(groups: SpecsRowGroup[], rowTops: number[]): GroupOutline[] {
  return groups
    .filter((g) => g.endRow + 1 < rowTops.length)
    .map((g) => ({
      id: g.id,
      name: g.name,
      hidden: Boolean(g.hidden),
      top: rowTops[g.startRow],
      height: rowTops[g.endRow + 1] - rowTops[g.startRow],
    }));
}

// Standard spreadsheet-style column lettering: 0->A, 25->Z, 26->AA, 27->AB, etc. Purely a display
// label — never stored, since columns are addressed by plain array index everywhere else.
function getColumnLetter(index: number): string {
  let n = index;
  let label = "";
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

const ROW_HEADER_WIDTH_PX = 36;
const COL_HEADER_HEIGHT_PX = 24;
const GRIDLINE_COLOR = "#D4D4D4";
const HEADER_BG = "#F3F3F3";
const HEADER_TEXT = "#666666";
// A project's own copy has no row-number column, and deliberately reserves NO table width for the
// hover "+ add row"/"- remove row" buttons either — they're rendered as a floating overlay strip that
// hangs off the left edge of the sheet instead (see the row-actions overlay in the render body), so
// the data columns always start flush at x=0 and line up evenly with the mock page's own left edge
// rather than being pushed over by a reserved gutter column. This is just that overlay strip's width.
const ADD_ROW_GUTTER_PX = 36;
// The group drag-handle strip sits flush against the +/- strip's own left edge (further out still),
// same reasoning as ADD_ROW_GUTTER_PX itself — a real reserved column would misalign the sheet's data
// columns from the mock page's print margins.
const GROUP_DRAG_HANDLE_WIDTH_PX = 20;

// Plain 1px gridlines are drawn as inset box-shadows, never a real `border` — a real border (even
// under `border-collapse: collapse`) makes the browser's table layout algorithm round each cell's
// USED height/width slightly away from the exact px value we asked for (confirmed directly: a row
// set to 20px measured 21px in Chrome's own getBoundingClientRect/getComputedStyle). That 1px-per-
// row slop compounds across consecutive short rows, so by the 5th short row the border/group-outline
// overlay (computed from the pure, assumed row heights) had drifted several px away from where the
// row actually rendered — this is exactly why borders looked "off the grid" on short label rows. An
// inset box-shadow paints inside the box without ever influencing layout, so it can't cause this
// class of drift no matter how many short rows are stacked. Each cell draws only its own right+bottom
// edge (the shared convention every other cell's left/top neighbor relies on); the very first row
// additionally draws its own top, and the very first column its own left, since nothing else can.
function gridlineBoxShadow(isFirstRow: boolean, isFirstCol: boolean): string {
  const parts = [`inset -1px 0 0 0 ${GRIDLINE_COLOR}`, `inset 0 -1px 0 0 ${GRIDLINE_COLOR}`];
  if (isFirstRow) parts.push(`inset 0 1px 0 0 ${GRIDLINE_COLOR}`);
  if (isFirstCol) parts.push(`inset 1px 0 0 0 ${GRIDLINE_COLOR}`);
  return parts.join(", ");
}

// Applies a style mutation to every real (non-null) cell touched by the current selection — falls
// back to just the single active cell when nothing was dragged (anchor === focus).
function mapSelectedCells(grid: SpecsGrid, sel: SpecsGridSelection, mutate: (style: SpecsCellStyle) => SpecsCellStyle): SpecsGrid {
  const rect = normalizeRect(sel);
  const rows = grid.rows.map((row, r) => {
    if (r < rect.minRow || r > rect.maxRow) return row;
    const cells = row.cells.map((cell, c) => {
      if (!cell || c < rect.minCol || c > rect.maxCol) return cell;
      return { ...cell, style: mutate(cell.style ?? {}) };
    });
    return { ...row, cells };
  });
  return { pageSize: grid.pageSize, columnWidths: grid.columnWidths, groups: grid.groups, deletedGroups: grid.deletedGroups, rows };
}

const toolbarButtonStyle = { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" } as const;
const toolbarButtonActiveStyle = { borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" } as const;
const toolbarDangerStyle = { borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" } as const;

export default function SpecsGridEditor({
  value,
  onChange,
  className,
  showPageSizeSelector,
  companyLogoUrl,
  companyColor,
  showGroupVisibilityPanel,
}: SpecsGridEditorProps) {
  const [liveGrid, setLiveGrid] = useState<SpecsGrid>(value);
  // Mirrors `liveGrid`, updated synchronously everywhere `liveGrid` is — lets the drag-end handlers
  // below read the truly-latest grid and call `onChange` from a plain event-handler call stack,
  // instead of peeking at it via a setState updater (calling another component's setState from
  // inside a setState updater function is not allowed and throws in React).
  const liveGridRef = useRef(value);
  const isDraggingRef = useRef(false);
  const [selection, setSelection] = useState<SpecsGridSelection | null>(null);
  // Mirrors `selection`, so the Ctrl/Cmd+C/V keyboard listener (mounted once, see below) can always
  // read the truly-latest selection without needing to re-subscribe on every render to pick up a
  // fresh closure — that re-subscribing was itself the bug: tearing down and re-attaching a window
  // listener on every render (including every tick of a drag-select or drag-resize, both of which
  // already re-render frequently) was visible as stutter/"glitching" while editing.
  const selectionRef = useRef<SpecsGridSelection | null>(null);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  // Which row's "+ add row" button is currently faded in — set on hovering anywhere in that row
  // (not just the small gutter cell itself), cleared on leaving it. Only rendered/used in a
  // project's own copy of the sheet (see isProjectSheetView below).
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);
  // Which single +/- button (identified as "remove-<row>" / "add-<row>") is directly under the
  // pointer right now — drives the per-button "lift off the sheet" hover effect below via inline
  // style rather than a CSS :hover rule, since this repo's Tailwind build wraps `hover:` variants in
  // `@media (hover: hover)` and — confirmed directly by inspecting the generated stylesheet — some
  // other rule already active on these buttons ends up taking precedence over it for `transform`
  // specifically, even though the exact same wrapped-hover pattern works fine for e.g. box-shadow
  // elsewhere. Tracking hover in JS sidesteps that entirely.
  const [liftedButtonKey, setLiftedButtonKey] = useState<string | null>(null);
  // Group drag-to-reorder (project view only). `manuallyHoveredGroupId` is set/cleared by the grip
  // handle's own hover, independent of `hoveredRowIndex` — the handle sits outside every row's own
  // bounding box, so without this it would fade out the instant the pointer left the row on its way
  // TO the handle (same "adjacent hover zone" problem already solved once for the row +/- buttons).
  const [manuallyHoveredGroupId, setManuallyHoveredGroupId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [draggingDeletedGroupId, setDraggingDeletedGroupId] = useState<string | null>(null);
  const [dropTargetRowIndex, setDropTargetRowIndex] = useState<number | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const isSelectingRef = useRef(false);
  // A per-cell onMouseUp alone only clears this when the button happens to be released while the
  // cursor is directly over a <td> — release it anywhere else (a resize handle, a header, the
  // toolbar, past the table's edge, or outside the window entirely) and it never fires, leaving
  // isSelectingRef stuck "true" so the very next mouseenter over any cell — even with the button no
  // longer held — silently resumes extending the selection. A single window-level listener catches
  // every release regardless of where it happens.
  useEffect(() => {
    const onWindowMouseUp = () => {
      isSelectingRef.current = false;
    };
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => window.removeEventListener("mouseup", onWindowMouseUp);
  }, []);
  const [colorPopover, setColorPopover] = useState<{ kind: "bg" | "border" | "text"; anchorRect: SpecsColorPopoverAnchorRect } | null>(null);
  const [headerContextMenu, setHeaderContextMenu] = useState<{ axis: "row" | "col"; index: number; x: number; y: number } | null>(null);
  const headerContextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!headerContextMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      if (headerContextMenuRef.current?.contains(e.target as Node)) return;
      setHeaderContextMenu(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [headerContextMenu]);

  const applyHeaderResize = (axis: "row" | "col", index: number, valuePx: number) => {
    if (axis === "col") {
      const clamped = Math.max(MIN_COL_WIDTH_PX, Math.round(valuePx));
      const columnWidths = [...liveGrid.columnWidths];
      columnWidths[index] = clamped;
      applyChange({ pageSize: liveGrid.pageSize, columnWidths, groups: liveGrid.groups, deletedGroups: liveGrid.deletedGroups, rows: liveGrid.rows }, true);
    } else {
      const clamped = Math.max(MIN_ROW_HEIGHT_PX, Math.round(valuePx));
      const rows = liveGrid.rows.map((r, ri) => (ri === index ? { ...r, heightPx: clamped } : r));
      applyChange({ pageSize: liveGrid.pageSize, columnWidths: liveGrid.columnWidths, groups: liveGrid.groups, deletedGroups: liveGrid.deletedGroups, rows }, true);
    }
  };

  // Inserts a BLANK templated copy of the given row directly below it — the "+" that fades in on
  // hover, in a project's own Specifications view. Same style/merges/height as the row it came from,
  // but never its actual text/image content — the point is a ready-to-fill "next line item", not a
  // clone of whatever data happened to already be in that row.
  const insertBlankTemplateRowBelow = (index: number) => {
    applyChange(duplicateRowAsBlankTemplate(liveGrid, index), true);
  };

  // The "-" that fades in next to the "+" on hover, in a project's own Specifications view. Goes
  // through removeRowWithArchive (not the plain removeRow) so that if this row belongs to a group,
  // it's filed into deletedGroups first — meaning even a whole group emptied one row at a time via
  // this exact button stays fully recoverable afterward (see the "Sections" bar's own restore chips).
  const removeRowAt = (index: number) => {
    applyChange(removeRowWithArchive(liveGrid, index), true);
  };

  const dragRef = useRef<{ axis: "col" | "row"; index: number; startPos: number; startSize: number } | null>(null);

  // The `value` prop only ever needs to be re-synced into local state while we're NOT mid-drag —
  // during a drag, liveGrid intentionally diverges from `value` (see the drag handlers below) so the
  // page hosting this editor isn't re-rendered on every pixel of mouse movement.
  // Syncs local editable state from the controlled `value` prop — same accepted pattern already
  // used in sidebar-color-picker-popover.tsx.
  useEffect(() => {
    if (isDraggingRef.current) return;
    liveGridRef.current = value;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLiveGrid(value);
  }, [value]);

  const applyChange = (next: SpecsGrid, persist: boolean) => {
    liveGridRef.current = next;
    setLiveGrid(next);
    if (persist) onChange(next);
  };

  const activeCell = (() => {
    if (!selection) return null;
    const rect = normalizeRect(selection);
    return { row: rect.minRow, col: rect.minCol, cell: liveGrid.rows[rect.minRow]?.cells[rect.minCol] ?? null };
  })();

  const canMerge = selection ? canMergeSelection(liveGrid, selection) : false;
  const canUnmerge = activeCell?.cell ? (() => {
    const { rowSpan, colSpan } = getCellSpan(activeCell.cell);
    return rowSpan > 1 || colSpan > 1;
  })() : false;

  const commitCellText = (row: number, col: number, text: string) => {
    const cell = liveGrid.rows[row]?.cells[col];
    if (!cell || cell.text === text) return;
    const rows = liveGrid.rows.map((r, ri) => {
      if (ri !== row) return r;
      const cells = r.cells.map((c, ci) => (ci === col ? { ...c!, text } : c));
      return { ...r, cells };
    });
    applyChange({ pageSize: liveGrid.pageSize, columnWidths: liveGrid.columnWidths, groups: liveGrid.groups, deletedGroups: liveGrid.deletedGroups, rows }, true);
  };

  const toggleStyle = (mutate: (style: SpecsCellStyle) => SpecsCellStyle) => {
    if (!selection) return;
    applyChange(mapSelectedCells(liveGrid, selection, mutate), true);
  };

  // The clipboard's actual data lives in a ref (no need to re-render on every keystroke-adjacent
  // access), but a small boolean state mirrors "is there something to paste" so the toolbar's Paste
  // button visibly enables right after a copy — reading a ref directly in JSX wouldn't re-render.
  const clipboardRef = useRef<(SpecsCell | null)[][] | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);

  // Reads liveGridRef/selectionRef (not the `liveGrid`/`selection` state directly) so this works
  // correctly whether called from a toolbar click (state is already fresh either way) or from the
  // mounted-once keyboard listener below (which only has ref access to avoid re-subscribing).
  const copySelection = () => {
    const sel = selectionRef.current;
    if (!sel) return;
    const grid = liveGridRef.current;
    const rect = normalizeRect(sel);
    const clip: (SpecsCell | null)[][] = [];
    for (let r = rect.minRow; r <= rect.maxRow; r += 1) {
      const rowCells: (SpecsCell | null)[] = [];
      for (let c = rect.minCol; c <= rect.maxCol; c += 1) {
        const cell = grid.rows[r]?.cells[c] ?? null;
        rowCells.push(cell ? (JSON.parse(JSON.stringify(cell)) as SpecsCell) : null);
      }
      clip.push(rowCells);
    }
    clipboardRef.current = clip;
    setHasClipboard(true);
  };

  // Pastes starting at the current selection's top-left cell, overwriting whatever is there —
  // including any colSpan/rowSpan on the copied cells, so a merged cell (or a whole row of them)
  // reproduces the same merge shape at the new position, not just its text/style.
  const pasteAtSelection = () => {
    const clip = clipboardRef.current;
    const sel = selectionRef.current;
    if (!clip || !sel) return;
    const grid = liveGridRef.current;
    const rect = normalizeRect(sel);
    const rows = grid.rows.map((r) => ({ ...r, cells: [...r.cells] }));
    for (let r = 0; r < clip.length; r += 1) {
      const targetRow = rect.minRow + r;
      if (targetRow >= rows.length) break;
      for (let c = 0; c < clip[r].length; c += 1) {
        const targetCol = rect.minCol + c;
        if (targetCol >= grid.columnWidths.length) break;
        const sourceCell = clip[r][c];
        rows[targetRow].cells[targetCol] = sourceCell ? (JSON.parse(JSON.stringify(sourceCell)) as SpecsCell) : null;
      }
    }
    applyChange({ pageSize: grid.pageSize, columnWidths: grid.columnWidths, groups: grid.groups, deletedGroups: grid.deletedGroups, rows }, true);
  };

  // Kept in sync after every render (a plain ref assignment, not a listener — refs can't be written
  // during render itself) so the mounted-once keyboard listener below always calls the freshest
  // closure — including the current onChange prop inside applyChange — without ever needing to
  // itself be torn down and re-attached.
  const copySelectionRef = useRef(copySelection);
  const pasteAtSelectionRef = useRef(pasteAtSelection);
  useEffect(() => {
    copySelectionRef.current = copySelection;
    pasteAtSelectionRef.current = pasteAtSelection;
  });

  // Ctrl/Cmd+C / Ctrl/Cmd+V at the grid level — skipped while actually editing a cell's text (its
  // own contentEditable is focused) so normal in-cell text copy/paste keeps working untouched.
  // Mounted exactly once: re-subscribing this on every render (it previously had no dependency
  // array) meant tearing down and re-attaching a window listener on every render — including every
  // tick of a drag-select or drag-resize, both of which already re-render frequently — which was
  // visible as stutter/"glitching" while editing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "c") {
        if (!selectionRef.current) return;
        e.preventDefault();
        copySelectionRef.current();
      } else if (key === "v") {
        if (!clipboardRef.current || !selectionRef.current) return;
        e.preventDefault();
        pasteAtSelectionRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Images target a single (or merged) cell, not every cell in a dragged selection — inserting a
  // logo into a multi-cell selection would drop it into each cell separately, which isn't what
  // "insert a logo" means; merge cells first for a bigger placement area.
  const setCellImage = (row: number, col: number, imageUrl: string | null) => {
    const cell = liveGrid.rows[row]?.cells[col];
    if (!cell) return;
    const rows = liveGrid.rows.map((r, ri) => {
      if (ri !== row) return r;
      const cells = r.cells.map((c, ci) => {
        if (ci !== col) return c;
        if (imageUrl) return { ...c!, imageUrl };
        // Firestore rejects an explicit `undefined` field value ("invalid-argument") — omit the
        // key entirely rather than setting it to undefined when clearing the image.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { imageUrl: _removed, ...rest } = c!;
        return rest;
      });
      return { ...r, cells };
    });
    applyChange({ pageSize: liveGrid.pageSize, columnWidths: liveGrid.columnWidths, groups: liveGrid.groups, deletedGroups: liveGrid.deletedGroups, rows }, true);
  };

  // Links a row range into a new named group. `startRow`/`endRow` normally come from the current
  // selection's row span (so highlighting cells across several rows, then right-clicking a row
  // number, links that whole span) — falls back to just the right-clicked row if nothing's selected.
  const linkRowsAsGroup = (startRow: number, endRow: number, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    applyChange(createRowGroup(liveGrid, startRow, endRow, trimmed), true);
  };

  const renameGroup = (groupId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    applyChange(renameRowGroup(liveGrid, groupId, trimmed), true);
  };

  const unlinkGroup = (groupId: string) => {
    applyChange(removeRowGroup(liveGrid, groupId), true);
  };

  // Extends an already-existing group to also cover the highlighted row range, instead of creating
  // a brand-new group — the "highlight any row or cell and add it to an existing group" flow.
  const addRowsToExistingGroup = (groupId: string, startRow: number, endRow: number) => {
    applyChange(addRowsToGroup(liveGrid, groupId, startRow, endRow), true);
  };

  const toggleGroupHidden = (groupId: string, hidden: boolean) => {
    applyChange(setRowGroupHidden(liveGrid, groupId, hidden), true);
  };

  const onColumnResizeStart = (index: number, clientX: number) => {
    isDraggingRef.current = true;
    dragRef.current = { axis: "col", index, startPos: clientX, startSize: liveGrid.columnWidths[index] };
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startPos;
      const nextWidth = Math.max(MIN_COL_WIDTH_PX, drag.startSize + delta);
      setLiveGrid((prev) => {
        const columnWidths = [...prev.columnWidths];
        columnWidths[drag.index] = nextWidth;
        const next = { pageSize: prev.pageSize, columnWidths, groups: prev.groups, rows: prev.rows };
        liveGridRef.current = next;
        return next;
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragRef.current = null;
      isDraggingRef.current = false;
      onChange(liveGridRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onRowResizeStart = (index: number, clientY: number) => {
    isDraggingRef.current = true;
    dragRef.current = { axis: "row", index, startPos: clientY, startSize: liveGrid.rows[index].heightPx };
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = e.clientY - drag.startPos;
      const nextHeight = Math.max(MIN_ROW_HEIGHT_PX, drag.startSize + delta);
      setLiveGrid((prev) => {
        const rows = prev.rows.map((r, ri) => (ri === drag.index ? { ...r, heightPx: nextHeight } : r));
        const next = { pageSize: prev.pageSize, columnWidths: prev.columnWidths, groups: prev.groups, rows };
        liveGridRef.current = next;
        return next;
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragRef.current = null;
      isDraggingRef.current = false;
      onChange(liveGridRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Sanitized once here and used for EVERYTHING derived from column/row sizing (the table's own
  // width, <col> elements, border segments, group outlines, resize-handle positions) — a single bad
  // stored value (however it got there — this app has already found more than one bug that could
  // write one) would otherwise poison every one of those, each surfacing as its own confusing
  // "NaN is an invalid value" console error instead of one clear root cause.
  const safeColumnWidths = liveGrid.columnWidths.map((w) => (typeof w === "number" && Number.isFinite(w) && w > 0 ? w : DEFAULT_COL_WIDTH_PX));

  // A project's own copy of the sheet renders read/print-oriented: no row-number/column-letter
  // headers, no drag-to-resize (both would invite restructuring a layout the company template
  // already fixed), no floating group name labels drawn over the sheet itself (the group's name is
  // already shown once, in the "Sections" checklist above the sheet — repeating it as a label on
  // every occurrence would be redundant clutter on what's meant to read like a finished document),
  // and no default gridlines (a real printed spec sheet only shows the borders someone explicitly
  // drew, not an editing grid). The company template builder (showGroupVisibilityPanel unset) keeps
  // all of this since it's actively being laid out, not read.
  const isProjectSheetView = Boolean(showGroupVisibilityPanel);
  // Project view reserves NO table width for a row header at all — the hover "+ add row"/"- remove
  // row" buttons live in a floating overlay outside the table instead (see the render body), so data
  // columns start flush at x=0 and line up with the mock page's own edge.
  const rowHeaderWidthPx = isProjectSheetView ? 0 : ROW_HEADER_WIDTH_PX;
  const colHeaderHeightPx = isProjectSheetView ? 0 : COL_HEADER_HEIGHT_PX;

  // Computed once per render and reused everywhere a group's bounds matter (outline, per-row
  // hide-check, the row header context menu's "already grouped?" check) — see getExpandedRowGroups'
  // own comment for why raw `liveGrid.groups` bounds can't be trusted directly. Only a project's own
  // copy (isProjectSheetView) actually collapses hidden rows to zero height — the company
  // template builder always shows every row so groups stay editable.
  const expandedGroups = getExpandedRowGroups(liveGrid);
  const hiddenRowIndexes = new Set<number>();
  if (isProjectSheetView) {
    for (const g of expandedGroups) {
      if (!g.hidden) continue;
      for (let r = g.startRow; r <= g.endRow; r += 1) hiddenRowIndexes.add(r);
    }
  }

  const safeRowHeights = liveGrid.rows.map((r, ri) => {
    if (hiddenRowIndexes.has(ri)) return 0;
    return typeof r.heightPx === "number" && Number.isFinite(r.heightPx) && r.heightPx > 0 ? r.heightPx : DEFAULT_ROW_HEIGHT_PX;
  });

  const colPrefixSums: number[] = [0];
  for (const w of safeColumnWidths) colPrefixSums.push(colPrefixSums[colPrefixSums.length - 1] + w);

  // Purely computed from data, exactly like colPrefixSums — no DOM measurement involved. This used
  // to be measured live via ResizeObserver/getBoundingClientRect, back when a row's height was only
  // a minimum (wrapped text could grow it taller). It's been a strict cap since the "row height
  // doesn't go below 20" fix (overflow:hidden directly on each td) — so every row now renders at
  // EXACTLY safeRowHeights[i], making a plain prefix sum both simpler and fully accurate. DOM
  // measurement was also the source of a real, confirmed bug: getBoundingClientRect() returns
  // viewport-relative (scroll-dependent) coordinates, which don't match the scroll-invariant
  // coordinate system position:absolute children of a scrollable container actually need — any
  // re-measure while scrolled baked in that scroll offset, so the border/group overlays came out
  // positioned above where their rows actually sit.
  const rowPrefixSums: number[] = [0];
  for (const h of safeRowHeights) rowPrefixSums.push(rowPrefixSums[rowPrefixSums.length - 1] + h);

  const borderSegments = computeBorderSegments(liveGrid, colPrefixSums, rowPrefixSums, hiddenRowIndexes);
  const groupOutlines = computeGroupOutlines(expandedGroups, rowPrefixSums);
  const tableTotalWidthPx = colPrefixSums[colPrefixSums.length - 1] ?? 0;

  // The "mock page" the sheet sits in — a white rectangle sized to the actual paper dimensions
  // (so print can be visualized), surrounded by a grey canvas. Only ever grown, never shrunk, past
  // the paper size: if the table itself (say, after someone widens columns or adds many rows) ends
  // up bigger than one physical page, letting the white area grow with it keeps the table fully on
  // white rather than clipping it or spilling content onto the grey — the paper-size box is a visual
  // reference, not a hard crop.
  const mockPageWidthPx = Math.round(SPECS_PAGE_SIZES[liveGrid.pageSize].widthMm * MM_TO_PX);
  const mockPageHeightPx = Math.round(SPECS_PAGE_SIZES[liveGrid.pageSize].heightMm * MM_TO_PX);
  // A project's own copy insets its content by the real print margin on every side (so the sheet
  // reads centered on the mock page, matching where it'll actually sit once printed) — the builder
  // keeps its own row/column header gutters instead, unchanged. Applied via a single wrapping div
  // around the table + all its overlays (see the render body) rather than folded into
  // rowHeaderWidthPx/colHeaderHeightPx, so it insets the table's OWN position too, not just where the
  // overlays draw relative to it — and it deliberately does NOT touch the table's own `width` (still
  // just the columns' real total), otherwise the last column would stretch to fill the inset.
  const mockPageMarginPx = isProjectSheetView ? Math.round(SPECS_PAGE_MARGIN_MM * MM_TO_PX) : 0;
  const tableRenderedWidthPx = rowHeaderWidthPx + tableTotalWidthPx + mockPageMarginPx * 2;
  const tableRenderedHeightPx = colHeaderHeightPx + (rowPrefixSums[rowPrefixSums.length - 1] ?? 0) + mockPageMarginPx * 2;
  const mockPageBoxWidthPx = Math.max(mockPageWidthPx, tableRenderedWidthPx);
  const mockPageBoxHeightPx = Math.max(mockPageHeightPx, tableRenderedHeightPx);

  // The grip handle's own hover keeps a group "active" even once the pointer has moved off its rows
  // and onto the handle itself (see manuallyHoveredGroupId's own comment) — falls back to whichever
  // group the currently-hovered ROW belongs to otherwise.
  const hoveredGroupId = manuallyHoveredGroupId ?? (hoveredRowIndex !== null ? (findRowGroupForRow(expandedGroups, hoveredRowIndex)?.id ?? null) : null);
  const restorableDeletedGroups = (liveGrid.deletedGroups ?? []).filter((dg) => !liveGrid.groups.some((g) => g.id === dg.id));

  // Valid places a drag can drop: the very top/bottom of the sheet, plus the start and end of every
  // OTHER group — never an arbitrary row line. A group is a single unit to drop above or below, not a
  // stack of individually-targetable rows, so mid-group row boundaries (and, while dragging a given
  // group, that same group's own edges — dropping there is a no-op moveRowGroup already rejects
  // anyway) are deliberately excluded from what the drop snaps to.
  const validDropRowIndexes = (() => {
    const set = new Set<number>([0, liveGrid.rows.length]);
    for (const g of expandedGroups) {
      if (draggingGroupId === g.id) continue;
      set.add(g.startRow);
      set.add(g.endRow + 1);
    }
    return Array.from(set).sort((a, b) => a - b);
  })();
  // Maps a drag's pointer Y position to the row index a drop there would insert AT (i.e. "before this
  // row") — snaps to whichever VALID boundary (from rowPrefixSums, the same coordinate space every
  // other overlay in this file already uses) is closest, so the drop doesn't need pixel-perfect aim.
  const computeDropRowIndex = (clientY: number): number => {
    const tableEl = tableRef.current;
    if (!tableEl) return 0;
    const localY = clientY - tableEl.getBoundingClientRect().top;
    let closestIdx = validDropRowIndexes[0] ?? 0;
    let closestDist = Infinity;
    for (const idx of validDropRowIndexes) {
      const dist = Math.abs((rowPrefixSums[idx] ?? 0) - localY);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = idx;
      }
    }
    return closestIdx;
  };
  const onSheetDragOver = (e: DragEvent<HTMLElement>) => {
    if (!draggingGroupId && !draggingDeletedGroupId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetRowIndex(computeDropRowIndex(e.clientY));
  };
  const onSheetDrop = (e: DragEvent<HTMLElement>) => {
    if (dropTargetRowIndex === null) return;
    e.preventDefault();
    if (draggingGroupId) applyChange(moveRowGroup(liveGrid, draggingGroupId, dropTargetRowIndex), true);
    else if (draggingDeletedGroupId) applyChange(restoreDeletedGroup(liveGrid, draggingDeletedGroupId, dropTargetRowIndex), true);
    setDraggingGroupId(null);
    setDraggingDeletedGroupId(null);
    setDropTargetRowIndex(null);
  };

  // Live drag preview — while dragging, shows where things will actually land by moving the REAL
  // surrounding rows out of the way (via a CSS transform per <tr>, see rowShiftOffsetById below)
  // rather than just a thin insertion line. Reuses moveRowGroup itself (not a hand-rolled shift
  // calc) to find each existing row's new position, so the preview is guaranteed to match exactly
  // what actually happens on drop — never a separate, potentially-diverging approximation.
  const rowShiftOffsetById = new Map<string, number>();
  let restorePreviewGap: { topPx: number; heightPx: number; name: string } | null = null;
  if (dropTargetRowIndex !== null) {
    if (draggingGroupId) {
      const previewGrid = moveRowGroup(liveGrid, draggingGroupId, dropTargetRowIndex);
      const previewSums: number[] = [0];
      for (const r of previewGrid.rows) {
        const h = typeof r.heightPx === "number" && Number.isFinite(r.heightPx) && r.heightPx > 0 ? r.heightPx : DEFAULT_ROW_HEIGHT_PX;
        previewSums.push(previewSums[previewSums.length - 1] + h);
      }
      const previewIndexById = new Map(previewGrid.rows.map((r, i) => [r.id, i]));
      liveGrid.rows.forEach((row, i) => {
        const newIndex = previewIndexById.get(row.id);
        if (newIndex === undefined) return;
        const offset = previewSums[newIndex] - rowPrefixSums[i];
        if (offset !== 0) rowShiftOffsetById.set(row.id, offset);
      });
    } else if (draggingDeletedGroupId) {
      const archived = (liveGrid.deletedGroups ?? []).find((dg) => dg.id === draggingDeletedGroupId);
      if (archived) {
        const blockHeightPx = archived.rows.reduce(
          (sum, r) => sum + (typeof r.heightPx === "number" && Number.isFinite(r.heightPx) && r.heightPx > 0 ? r.heightPx : DEFAULT_ROW_HEIGHT_PX),
          0,
        );
        liveGrid.rows.forEach((row, i) => {
          if (i >= dropTargetRowIndex) rowShiftOffsetById.set(row.id, blockHeightPx);
        });
        restorePreviewGap = { topPx: rowPrefixSums[dropTargetRowIndex] ?? 0, heightPx: blockHeightPx, name: archived.name };
      }
    }
  }

  // A single rectangle around the WHOLE selection, drawn once as an overlay — not a ring redrawn on
  // every selected <td> (the previous approach). Two adjacent selected cells each drawing their own
  // inset ring doubled up into a visible extra line sitting just inside the shared gridline, instead
  // of the gridline itself reading as the selection's edge — this way there's exactly one line, and
  // it sits on the real boundary between selected and unselected cells. Expanded to fully cover any
  // merge the raw selection only touches the anchor of — clicking a merged cell produces a plain 1x1
  // selection at its top-left slot, which would otherwise draw an outline the size of just that one
  // slot instead of the whole visually-merged cell.
  const selectionOutline = (() => {
    if (!selection) return null;
    const rect = expandRectForMergedSpans(liveGrid, normalizeRect(selection));
    const left = colPrefixSums[rect.minCol];
    const right = colPrefixSums[rect.maxCol + 1];
    const top = rowPrefixSums[rect.minRow];
    const bottom = rowPrefixSums[rect.maxRow + 1];
    if (left === undefined || right === undefined || top === undefined || bottom === undefined) return null;
    return { left, top, width: right - left, height: bottom - top };
  })();

  return (
    <div className={className ?? "flex h-full w-full flex-col"}>
      <div className="flex flex-wrap items-center gap-1.5 border-b p-2" style={{ borderColor: "var(--glass-border)" }}>
        {showPageSizeSelector ? (
          <>
            <label className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold" style={toolbarButtonStyle}>
              Sheet Size
              <select
                value={liveGrid.pageSize}
                onChange={(e) => applyChange(resizeGridToPageSize(liveGrid, e.target.value as SpecsPageSize), true)}
                className="bg-transparent text-[11px] font-bold outline-none"
                style={{ color: "var(--text-main)" }}
              >
                {(Object.keys(SPECS_PAGE_SIZES) as SpecsPageSize[]).map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <div className="mx-1 h-6 w-px" style={{ backgroundColor: "var(--glass-border)" }} />
          </>
        ) : null}
        <button type="button" onClick={() => toggleStyle((s) => ({ ...s, bold: !s.bold }))} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border" style={toolbarButtonStyle} title="Bold">
          <Bold size={14} />
        </button>
        <label className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold" style={toolbarButtonStyle} title="Text size">
          Size
          <input
            key={activeCell ? `${activeCell.row}:${activeCell.col}` : "none"}
            type="number"
            min={6}
            max={96}
            defaultValue={activeCell?.cell?.style?.fontSize ?? DEFAULT_CELL_FONT_SIZE_PX}
            onChange={(e) => {
              const value = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(value) && value > 0) toggleStyle((s) => ({ ...s, fontSize: value }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            className="w-12 bg-transparent text-[11px] font-bold outline-none"
            style={{ color: "var(--text-main)" }}
          />
        </label>
        <div className="mx-0.5 h-6 w-px" style={{ backgroundColor: "var(--glass-border)" }} />
        <button type="button" onClick={() => toggleStyle((s) => ({ ...s, align: "left" }))} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border" style={(activeCell?.cell?.style?.align ?? (activeCell?.cell?.imageUrl ? "center" : "left")) === "left" ? toolbarButtonActiveStyle : toolbarButtonStyle} title="Align left">
          <AlignLeft size={14} />
        </button>
        <button type="button" onClick={() => toggleStyle((s) => ({ ...s, align: "center" }))} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border" style={(activeCell?.cell?.style?.align ?? (activeCell?.cell?.imageUrl ? "center" : "left")) === "center" ? toolbarButtonActiveStyle : toolbarButtonStyle} title="Align center">
          <AlignCenter size={14} />
        </button>
        <button type="button" onClick={() => toggleStyle((s) => ({ ...s, align: "right" }))} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border" style={activeCell?.cell?.style?.align === "right" ? toolbarButtonActiveStyle : toolbarButtonStyle} title="Align right">
          <AlignRight size={14} />
        </button>
        <div className="mx-0.5 h-6 w-px" style={{ backgroundColor: "var(--glass-border)" }} />
        <button type="button" onClick={() => toggleStyle((s) => ({ ...s, verticalAlign: "top" }))} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border" style={(activeCell?.cell?.style?.verticalAlign ?? (activeCell?.cell?.imageUrl ? "middle" : "top")) === "top" ? toolbarButtonActiveStyle : toolbarButtonStyle} title="Align top">
          <AlignVerticalJustifyStart size={14} />
        </button>
        <button type="button" onClick={() => toggleStyle((s) => ({ ...s, verticalAlign: "middle" }))} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border" style={(activeCell?.cell?.style?.verticalAlign ?? (activeCell?.cell?.imageUrl ? "middle" : "top")) === "middle" ? toolbarButtonActiveStyle : toolbarButtonStyle} title="Align middle">
          <AlignVerticalJustifyCenter size={14} />
        </button>
        <button type="button" onClick={() => toggleStyle((s) => ({ ...s, verticalAlign: "bottom" }))} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border" style={activeCell?.cell?.style?.verticalAlign === "bottom" ? toolbarButtonActiveStyle : toolbarButtonStyle} title="Align bottom">
          <AlignVerticalJustifyEnd size={14} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setColorPopover({ kind: "bg", anchorRect: { left: rect.left, top: rect.bottom, width: rect.width, height: 0 } });
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold"
          style={toolbarButtonStyle}
        >
          <span className="inline-block h-4 w-4 rounded-[4px] border" style={{ backgroundColor: activeCell?.cell?.style?.bgColor ?? "transparent", borderColor: "var(--glass-border)" }} />
          Fill
        </button>
        <button
          type="button"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setColorPopover({ kind: "text", anchorRect: { left: rect.left, top: rect.bottom, width: rect.width, height: 0 } });
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold"
          style={toolbarButtonStyle}
        >
          <span
            className="inline-block h-4 w-4 rounded-[4px] border text-center text-[11px] font-bold leading-4"
            style={{ color: activeCell?.cell?.style?.textColor ?? "var(--text-main)", borderColor: "var(--glass-border)" }}
          >
            A
          </span>
          Text
        </button>
        {(["Top", "Right", "Bottom", "Left"] as const).map((side) => {
          const key = (`border${side}` as const);
          const isOn = Boolean(activeCell?.cell?.style?.[key]);
          return (
            <button
              key={side}
              type="button"
              onClick={() => toggleStyle((s) => ({ ...s, [key]: !s[key] }))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border text-[11px] font-bold"
              style={isOn ? toolbarButtonActiveStyle : toolbarButtonStyle}
              title={`Toggle ${side.toLowerCase()} border`}
            >
              {side[0]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setColorPopover({ kind: "border", anchorRect: { left: rect.left, top: rect.bottom, width: rect.width, height: 0 } });
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold"
          style={toolbarButtonStyle}
        >
          <span className="inline-block h-4 w-4 rounded-[4px] border-2" style={{ borderColor: activeCell?.cell?.style?.borderColor ?? "var(--text-main)" }} />
          Border
        </button>
        <label className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold" style={toolbarButtonStyle} title="Border width">
          Width
          <input
            key={activeCell ? `${activeCell.row}:${activeCell.col}` : "none"}
            type="number"
            min={MIN_BORDER_WIDTH_PX}
            max={MAX_BORDER_WIDTH_PX}
            defaultValue={activeCell?.cell?.style?.borderWidthPx ?? DEFAULT_BORDER_WIDTH_PX}
            onChange={(e) => {
              const value = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(value) && value > 0) toggleStyle((s) => ({ ...s, borderWidthPx: value }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            className="w-10 bg-transparent text-[11px] font-bold outline-none"
            style={{ color: "var(--text-main)" }}
          />
        </label>
        {companyLogoUrl ? (
          <>
            <div className="mx-1 h-6 w-px" style={{ backgroundColor: "var(--glass-border)" }} />
            <button
              type="button"
              disabled={!activeCell}
              onClick={() => activeCell && setCellImage(activeCell.row, activeCell.col, companyLogoUrl)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold disabled:opacity-40"
              style={toolbarButtonStyle}
              title="Insert company logo into the selected cell"
            >
              <ImageIcon size={14} />
              Insert Logo
            </button>
            {activeCell?.cell?.imageUrl ? (
              <button
                type="button"
                onClick={() => activeCell && setCellImage(activeCell.row, activeCell.col, null)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold"
                style={toolbarDangerStyle}
                title="Remove image from the selected cell"
              >
                <ImageOff size={14} />
                Remove Image
              </button>
            ) : null}
          </>
        ) : null}
        <div className="mx-1 h-6 w-px" style={{ backgroundColor: "var(--glass-border)" }} />
        <button
          type="button"
          disabled={!selection}
          onClick={copySelection}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold disabled:opacity-40"
          style={toolbarButtonStyle}
          title="Copy (Ctrl+C)"
        >
          <Copy size={14} /> Copy
        </button>
        <button
          type="button"
          disabled={!hasClipboard || !activeCell}
          onClick={pasteAtSelection}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold disabled:opacity-40"
          style={toolbarButtonStyle}
          title="Paste (Ctrl+V) — reproduces copied merges too"
        >
          <ClipboardPaste size={14} /> Paste
        </button>
        <div className="mx-1 h-6 w-px" style={{ backgroundColor: "var(--glass-border)" }} />
        <button
          type="button"
          disabled={!canMerge}
          onClick={() => {
            if (!selection) return;
            applyChange(mergeSelection(liveGrid, selection), true);
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold disabled:opacity-40"
          style={toolbarButtonStyle}
        >
          Merge
        </button>
        <button
          type="button"
          disabled={!canUnmerge}
          onClick={() => {
            if (!activeCell) return;
            applyChange(unmergeCell(liveGrid, activeCell.row, activeCell.col), true);
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold disabled:opacity-40"
          style={toolbarButtonStyle}
        >
          Split
        </button>
        <div className="mx-1 h-6 w-px" style={{ backgroundColor: "var(--glass-border)" }} />
        <button
          type="button"
          onClick={() => applyChange(insertRow(liveGrid, (activeCell?.row ?? liveGrid.rows.length - 1) + 1), true)}
          className="inline-flex h-8 items-center gap-1 rounded-[8px] border px-2 text-[11px] font-bold"
          style={toolbarButtonStyle}
        >
          <Plus size={12} /> Row
        </button>
        <button
          type="button"
          onClick={() => activeCell && applyChange(removeRow(liveGrid, activeCell.row), true)}
          className="inline-flex h-8 items-center gap-1 rounded-[8px] border px-2 text-[11px] font-bold"
          style={toolbarDangerStyle}
        >
          <Trash2 size={12} /> Row
        </button>
        <button
          type="button"
          onClick={() => applyChange(insertColumn(liveGrid, (activeCell?.col ?? liveGrid.columnWidths.length - 1) + 1), true)}
          className="inline-flex h-8 items-center gap-1 rounded-[8px] border px-2 text-[11px] font-bold"
          style={toolbarButtonStyle}
        >
          <Plus size={12} /> Col
        </button>
        <button
          type="button"
          onClick={() => activeCell && applyChange(removeColumn(liveGrid, activeCell.col), true)}
          className="inline-flex h-8 items-center gap-1 rounded-[8px] border px-2 text-[11px] font-bold"
          style={toolbarDangerStyle}
        >
          <Trash2 size={12} /> Col
        </button>
      </div>

      {isProjectSheetView && (liveGrid.groups.length > 0 || restorableDeletedGroups.length > 0) ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b p-2" style={{ borderColor: "var(--glass-border)" }}>
          <span className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
            Sections:
          </span>
          {liveGrid.groups.map((g) => {
            const hidden = Boolean(g.hidden);
            return (
              <button
                key={g.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDraggingGroupId(g.id);
                }}
                onDragEnd={() => {
                  setDraggingGroupId(null);
                  setDropTargetRowIndex(null);
                }}
                onClick={() => toggleGroupHidden(g.id, !hidden)}
                className="inline-flex h-7 cursor-grab items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold active:cursor-grabbing"
                style={hidden ? toolbarButtonStyle : toolbarButtonActiveStyle}
                title={hidden ? `Show "${g.name}" in the printed sheet — drag to reorder` : `Hide "${g.name}" from the printed sheet — drag to reorder`}
              >
                {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                {g.name}
              </button>
            );
          })}
          {restorableDeletedGroups.length > 0 ? (
            <>
              <div className="mx-1 h-5 w-px" style={{ backgroundColor: "var(--glass-border)" }} />
              {restorableDeletedGroups.map((dg) => (
                <div
                  key={dg.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDraggingDeletedGroupId(dg.id);
                  }}
                  onDragEnd={() => {
                    setDraggingDeletedGroupId(null);
                    setDropTargetRowIndex(null);
                  }}
                  title={`"${dg.name}" was deleted — drag it back into the sheet anywhere you like`}
                  className="inline-flex h-7 cursor-grab items-center gap-1.5 rounded-[8px] border border-dashed px-2 text-[11px] font-bold active:cursor-grabbing"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
                >
                  <Undo2 size={12} />
                  {dg.name}
                </div>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      {/* Grey "canvas" the sheet sits on, matching the same white-page-on-grey convention already
          used for the Quote tab's own paged print preview (quote-preview-stage) — the mock page below
          is the only white surface in here, so print layout (what's actually on the page vs. spilling
          past it) reads clearly at a glance. Hardcoded, not theme tokens: this represents a physical
          sheet of paper, which doesn't have a dark mode. */}
      <div className="relative min-h-0 flex-1 overflow-auto p-6" style={{ backgroundColor: "#EDEFF4" }}>
        <div className="relative mx-auto" style={{ width: mockPageBoxWidthPx, minHeight: mockPageBoxHeightPx, backgroundColor: "#ffffff", boxShadow: "0 1px 4px rgba(16, 24, 40, 0.15)" }}>
        {/* Insets the table + every overlay below it (borders, selection, resize handles, the row
            +/- buttons) by the real print margin as ONE unit, so a project's own copy reads centered
            on the page instead of flush against its left/top edge. Positioned via absolute left/top
            (against the page div above, its nearest `position:relative` ancestor) rather than a plain
            margin — a margin here would collapse straight through this div's own top edge (it has no
            border/padding of its own to stop that), landing the whole white page 32px lower instead of
            inserting space inside it. Still `position:relative` itself, which is what makes THIS the
            containing block the table's sibling overlays resolve their own `left`/`top` against, so
            the same inset applies to all of them as one unit, not just the table. */}
        <div
          className="relative"
          style={mockPageMarginPx ? { position: "absolute", left: mockPageMarginPx, top: mockPageMarginPx } : undefined}
          onDragOver={isProjectSheetView ? onSheetDragOver : undefined}
          onDrop={isProjectSheetView ? onSheetDrop : undefined}
        >
        <table ref={tableRef} style={{ tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, width: rowHeaderWidthPx + colPrefixSums[colPrefixSums.length - 1] }}>
          <colgroup>
            {isProjectSheetView ? null : <col style={{ width: rowHeaderWidthPx }} />}
            {safeColumnWidths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          {isProjectSheetView ? null : (
            <thead>
              <tr style={{ height: COL_HEADER_HEIGHT_PX }}>
                <th style={{ backgroundColor: HEADER_BG, boxShadow: gridlineBoxShadow(true, true) }} />
                {liveGrid.columnWidths.map((_, colIdx) => (
                  <th
                    key={colIdx}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setHeaderContextMenu({ axis: "col", index: colIdx, x: e.clientX, y: e.clientY });
                    }}
                    className="cursor-context-menu text-[11px] font-normal"
                    style={{ backgroundColor: HEADER_BG, boxShadow: gridlineBoxShadow(true, false), color: HEADER_TEXT }}
                  >
                    {getColumnLetter(colIdx)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {liveGrid.rows.map((row, rowIdx) => {
              // A hidden group's rows are fully skipped here (not just dimmed) whenever
              // showGroupVisibilityPanel is on — safeRowHeights already zeroed their height for the
              // border/outline math above, but the <tr> itself still needs to not render at all so
              // its cells' focus/selection/context-menu handlers don't linger.
              if (hiddenRowIndexes.has(rowIdx)) return null;
              // Purely a paint-time offset — doesn't touch this row's actual box in the table's own
              // layout, so every OTHER row's real position is completely unaffected by it. That's
              // exactly what makes this safe to apply per-row independently: each row just visually
              // slides to where rowShiftOffsetById says its drop-preview position is, with no need to
              // actually restructure the table while a drag is in progress.
              const dragShiftPx = rowShiftOffsetById.get(row.id) ?? 0;
              return (
              <tr
                key={row.id}
                style={{
                  height: safeRowHeights[rowIdx],
                  transform: dragShiftPx ? `translateY(${dragShiftPx}px)` : undefined,
                  transition: draggingGroupId || draggingDeletedGroupId ? "transform 150ms ease" : undefined,
                }}
                onMouseEnter={isProjectSheetView ? () => setHoveredRowIndex(rowIdx) : undefined}
                onMouseLeave={isProjectSheetView ? () => setHoveredRowIndex((prev) => (prev === rowIdx ? null : prev)) : undefined}
              >
                {isProjectSheetView ? null : (
                <td
                  onMouseDown={(e) => {
                    // Right-click is a mousedown too — preserve an existing selection if this row is
                    // already part of it (so "Link Rows as Group" can act on the whole highlighted
                    // range), same special-case the data cells already use.
                    const lastCol = Math.max(0, liveGrid.columnWidths.length - 1);
                    if (e.button === 2) {
                      if (selection) {
                        const rect = normalizeRect(selection);
                        if (rowIdx >= rect.minRow && rowIdx <= rect.maxRow) return;
                      }
                      setSelection({ anchorRow: rowIdx, anchorCol: 0, focusRow: rowIdx, focusCol: lastCol });
                      return;
                    }
                    if (e.shiftKey && selection) {
                      setSelection((prev) => (prev ? { ...prev, focusRow: rowIdx, focusCol: lastCol } : prev));
                      return;
                    }
                    // Clicking/dragging down the row-number column selects whole rows (every column),
                    // the "highlight rows" gesture used to build a row group.
                    isSelectingRef.current = true;
                    setSelection({ anchorRow: rowIdx, anchorCol: 0, focusRow: rowIdx, focusCol: lastCol });
                  }}
                  onMouseEnter={() => {
                    if (!isSelectingRef.current) return;
                    const lastCol = Math.max(0, liveGrid.columnWidths.length - 1);
                    setSelection((prev) => (prev ? { ...prev, focusRow: rowIdx, focusCol: lastCol } : prev));
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setHeaderContextMenu({ axis: "row", index: rowIdx, x: e.clientX, y: e.clientY });
                  }}
                  className="cursor-context-menu overflow-hidden text-center text-[11px] font-normal"
                  style={{ height: safeRowHeights[rowIdx], backgroundColor: HEADER_BG, boxShadow: gridlineBoxShadow(rowIdx === 0, true), color: HEADER_TEXT }}
                >
                  {/* Same fix as the data cells' own text div: a table row's height only shrinks to
                      match its shortest configured row if EVERY cell's own content also has an
                      explicit height capping it — a bare text node here (no wrapper) still has its
                      own natural line-height, and since every cell in a <tr> shares one row height,
                      that alone was enough to keep the whole row from going below ~17px regardless of
                      what the data cells requested. */}
                  <div style={{ height: safeRowHeights[rowIdx], overflow: "hidden" }}>{rowIdx + 1}</div>
                </td>
                )}
                {row.cells.map((cell, colIdx) => {
                  if (cell === null) return null;
                  const { rowSpan, colSpan } = getCellSpan(cell);
                  const key = `${rowIdx}:${colIdx}`;
                  const style = cell.style ?? {};
                  // A table row's `height` is only a floor — content that needs more space always
                  // wins, which is exactly why a very short row (e.g. 5px) never actually rendered
                  // that short once a cell's own text/line-height needed more room. Pinning an
                  // explicit height (summed across any rowSpan) plus overflow:hidden directly on the
                  // td is what actually caps it: content that doesn't fit clips instead of forcing
                  // the row taller.
                  let spannedHeightPx = safeRowHeights[rowIdx];
                  if (rowSpan > 1) {
                    spannedHeightPx = 0;
                    for (let idx = rowIdx; idx < rowIdx + rowSpan && idx < liveGrid.rows.length; idx += 1) {
                      spannedHeightPx += safeRowHeights[idx];
                    }
                  }
                  return (
                    <td
                      key={key}
                      colSpan={colSpan > 1 ? colSpan : undefined}
                      rowSpan={rowSpan > 1 ? rowSpan : undefined}
                      onMouseDown={(e) => {
                        // Right-click is a mousedown too, and fires before onContextMenu — without
                        // this check, right-clicking anywhere would collapse a multi-cell selection
                        // down to just the clicked cell before the context menu ever saw it. Keep an
                        // existing selection intact if it already covers this cell (so "Link Cells as
                        // Group" operates on the whole highlighted range); only reset to this single
                        // cell if it's outside whatever's currently selected.
                        if (e.button === 2) {
                          if (selection && isCellInRect(rowIdx, colIdx, normalizeRect(selection))) return;
                          setSelection({ anchorRow: rowIdx, anchorCol: colIdx, focusRow: rowIdx, focusCol: colIdx });
                          return;
                        }
                        // Shift+click extends the existing selection's focus corner instead of
                        // starting a brand-new 1x1 selection — lets a two-cell (or larger) range be
                        // built with two plain clicks, not just a continuous drag.
                        if (e.shiftKey && selection) {
                          setSelection((prev) => (prev ? { ...prev, focusRow: rowIdx, focusCol: colIdx } : prev));
                          return;
                        }
                        isSelectingRef.current = true;
                        setSelection({ anchorRow: rowIdx, anchorCol: colIdx, focusRow: rowIdx, focusCol: colIdx });
                      }}
                      onMouseEnter={() => {
                        if (!isSelectingRef.current) return;
                        setSelection((prev) => (prev ? { ...prev, focusRow: rowIdx, focusCol: colIdx } : prev));
                      }}
                      onContextMenu={(e) => {
                        // Right-clicking a data cell opens the exact same row-grouping menu as
                        // right-clicking the row number — "highlight any row OR individual cell and
                        // add it to a group" — reusing headerContextMenu's row-axis rendering, which
                        // already derives the row range from the current selection when it's
                        // multi-row, falling back to just this cell's own row otherwise.
                        e.preventDefault();
                        setHeaderContextMenu({ axis: "row", index: rowIdx, x: e.clientX, y: e.clientY });
                      }}
                      className={cell.imageUrl ? "group p-0" : "p-0"}
                      style={{
                        position: "relative",
                        height: spannedHeightPx,
                        overflow: "hidden",
                        // Vertical alignment for TEXT cells is handled by the flex wrapper around
                        // SpecsCellTextArea below, not by this `vertical-align` — a table cell only
                        // hands its content the space it doesn't already claim for itself, and a
                        // block child capped with `maxHeight` (rather than a fixed `height`, so a
                        // short line of text could shrink to its own natural size and leave room to
                        // align within) turned out to still get silently stretched to fill that
                        // maxHeight anyway in Chrome's table layout — confirmed directly via
                        // getComputedStyle, `height` resolved to the maxHeight value even with no
                        // `height` of its own set, leaving zero slack for `vertical-align` to ever
                        // show any difference between top/middle/bottom. A flex column with a
                        // genuinely fixed height sidesteps that table-cell-specific quirk entirely.
                        // Image cells don't need this — they're already explicitly positioned via
                        // imageObjectPositionFor.
                        // Fill color always shows now — selection used to be indicated by replacing
                        // this with the blue tint, which made an applied fill invisible for as long
                        // as the cell stayed selected (i.e. the whole time you're picking a color).
                        // Selection is now a ring (boxShadow, below) drawn on top instead.
                        backgroundColor: style.bgColor ?? "#ffffff",
                        // The plain gridline (as a non-layout-affecting inset shadow, not a real
                        // `border` — see gridlineBoxShadow's own comment) only shows in the builder —
                        // a project's own read/print-oriented copy shows just the borders someone
                        // actually drew, not an editing grid. Explicit borders render as a separate
                        // overlay on top of the whole table either way (see computeBorderSegments), so
                        // this never needs to be suppressed to make room for one. The selection ring
                        // itself is a single rectangle drawn once around the whole selection (see
                        // selectionOutline below), not per-cell here — a per-cell ring doubled up into
                        // a visible extra line wherever two selected cells shared a gridline.
                        boxShadow: isProjectSheetView ? undefined : gridlineBoxShadow(rowIdx === 0, colIdx === 0),
                      }}
                    >
                      {cell.imageUrl ? (
                        // Absolutely positioned against the td (given position:relative above) rather
                        // than sized via height:100% — percentage heights on a direct table-cell child
                        // are inconsistently honored across browsers, while an absolutely positioned
                        // element's box always resolves against its containing block's padding box, so
                        // this reliably tracks the cell's real size (including as rows/columns resize).
                        <>
                          <img
                            src={cell.imageUrl}
                            alt=""
                            draggable={false}
                            className="pointer-events-none absolute inset-0 select-none object-contain"
                            // `inset-0` alone only pins the four offsets — for a replaced element like
                            // <img>, that does NOT stretch it to fill the box (per CSS's absolute-
                            // positioning sizing rules for replaced elements, it still sizes itself
                            // from its own intrinsic dimensions), so object-fit/object-position had
                            // nothing to work with. Explicit 100%/100% forces the img's own box to
                            // actually be the full cell, which is what those properties need.
                            style={{ width: "100%", height: "100%", objectPosition: imageObjectPositionFor(style) }}
                          />
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCellImage(rowIdx, colIdx, null);
                            }}
                            title="Remove image"
                            className="absolute right-1 top-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                            style={{ backgroundColor: "var(--danger-strong)", color: "#ffffff" }}
                          >
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <div
                          style={{
                            height: spannedHeightPx,
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent:
                              style.verticalAlign === "middle" ? "center" : style.verticalAlign === "bottom" ? "flex-end" : "flex-start",
                          }}
                        >
                          <SpecsCellTextArea
                            cellKey={key}
                            text={cell.text}
                            style={style}
                            isFocused={focusedKey === key}
                            onFocusCell={() => setFocusedKey(key)}
                            onBlurCommit={(text) => {
                              setFocusedKey((prev) => (prev === key ? null : prev));
                              commitCellText(rowIdx, colIdx, text);
                            }}
                          />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>

        {/* The hover "+ add row"/"- remove row" buttons, for a project's own copy only — floated
            outside the table entirely (not a reserved gutter column) so they can hang off the left
            edge of the sheet and overlap the grey canvas beyond the mock page's white area, rather
            than eating into the table's own width and pushing the data columns out of alignment with
            the page's true print margins. Positioned flush against the table's left edge (touching,
            zero gap) so a mouse moving from the row into the button crosses no dead space — each
            strip mirrors the row's own hover state independently, since it sits outside the <tr>'s
            own bounding box and wouldn't otherwise catch that row's mouseenter/mouseleave. */}
        {isProjectSheetView
          ? liveGrid.rows.map((row, rowIdx) => {
              if (hiddenRowIndexes.has(rowIdx)) return null;
              const isHovered = hoveredRowIndex === rowIdx;
              return (
                <div
                  key={row.id}
                  className="absolute flex items-center justify-center gap-1"
                  style={{ left: -ADD_ROW_GUTTER_PX, top: colHeaderHeightPx + rowPrefixSums[rowIdx], width: ADD_ROW_GUTTER_PX, height: safeRowHeights[rowIdx] }}
                  onMouseEnter={() => setHoveredRowIndex(rowIdx)}
                  onMouseLeave={() => setHoveredRowIndex((prev) => (prev === rowIdx ? null : prev))}
                >
                  <div
                    className="flex items-center gap-1 transition-opacity duration-150"
                    style={{ opacity: isHovered ? 1 : 0, pointerEvents: isHovered ? "auto" : "none" }}
                  >
                    {/* Lifts just the individual button being pointed at (via liftedButtonKey, not
                        the opacity above, which is the whole strip's own hover-in/out), as if it's
                        raised slightly off the sheet, independent of its sibling. */}
                    <button
                      type="button"
                      onClick={() => removeRowAt(rowIdx)}
                      onMouseEnter={() => setLiftedButtonKey(`remove-${rowIdx}`)}
                      onMouseLeave={() => setLiftedButtonKey((prev) => (prev === `remove-${rowIdx}` ? null : prev))}
                      title="Remove this row"
                      className="flex h-4 w-4 items-center justify-center rounded-full transition-transform duration-150"
                      style={{
                        backgroundColor: "#EF4444",
                        color: "#ffffff",
                        transform: liftedButtonKey === `remove-${rowIdx}` ? "translateY(-2px)" : "none",
                        boxShadow: liftedButtonKey === `remove-${rowIdx}` ? "0 3px 6px rgba(0, 0, 0, 0.4)" : "none",
                      }}
                    >
                      <Minus size={12} strokeWidth={3} color="#ffffff" />
                    </button>
                    <button
                      type="button"
                      onClick={() => insertBlankTemplateRowBelow(rowIdx)}
                      onMouseEnter={() => setLiftedButtonKey(`add-${rowIdx}`)}
                      onMouseLeave={() => setLiftedButtonKey((prev) => (prev === `add-${rowIdx}` ? null : prev))}
                      title="Add a blank row below"
                      className="flex h-4 w-4 items-center justify-center rounded-full transition-transform duration-150"
                      style={{
                        backgroundColor: "#22C55E",
                        color: "#ffffff",
                        marginRight: 5,
                        transform: liftedButtonKey === `add-${rowIdx}` ? "translateY(-2px)" : "none",
                        boxShadow: liftedButtonKey === `add-${rowIdx}` ? "0 3px 6px rgba(0, 0, 0, 0.4)" : "none",
                      }}
                    >
                      <Plus size={12} strokeWidth={3} color="#ffffff" />
                    </button>
                  </div>
                </div>
              );
            })
          : null}

        {/* Per-group drag handle — grabbing it and dropping elsewhere in the sheet moves that WHOLE
            group (moveRowGroup always carries its full contiguous row range as one block, so there's
            no way to drop only part of it). Positioned flush against the row +/- strip's own left
            edge (touching it, zero gap) for the same reason that strip is flush against the table —
            so hovering a row, sliding onto the +/- strip, then onto this handle never crosses a dead
            zone that would fade either one out early. */}
        {isProjectSheetView
          ? expandedGroups.map((g) => {
              const isActive = hoveredGroupId === g.id || draggingGroupId === g.id;
              return (
                <div
                  key={g.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDraggingGroupId(g.id);
                  }}
                  onDragEnd={() => {
                    setDraggingGroupId(null);
                    setDropTargetRowIndex(null);
                  }}
                  onMouseEnter={() => setManuallyHoveredGroupId(g.id)}
                  onMouseLeave={() => setManuallyHoveredGroupId((prev) => (prev === g.id ? null : prev))}
                  title={`Drag to move "${g.name}"`}
                  className="absolute flex cursor-grab items-center justify-center rounded-[6px] border transition-opacity duration-150 active:cursor-grabbing"
                  style={{
                    left: -(ADD_ROW_GUTTER_PX + GROUP_DRAG_HANDLE_WIDTH_PX),
                    top: colHeaderHeightPx + rowPrefixSums[g.startRow],
                    width: GROUP_DRAG_HANDLE_WIDTH_PX,
                    height: rowPrefixSums[g.endRow + 1] - rowPrefixSums[g.startRow],
                    opacity: isActive ? 1 : 0,
                    pointerEvents: isActive ? "auto" : "none",
                    backgroundColor: "var(--panel-muted)",
                    borderColor: "var(--glass-border)",
                  }}
                >
                  <GripVertical size={12} color="var(--text-muted)" />
                </div>
              );
            })
          : null}

        {/* Dragging an EXISTING group needs no separate indicator — its own rows are already
            reflowing (via rowShiftOffsetById on each <tr>, above) to sit right where they'll land,
            which shows "where it'll actually sit" more directly than a thin line ever could.
            Restoring a DELETED group has no rows in the live table to reflow into place, so it gets
            a real placeholder here instead — sized and labeled like the group that's about to drop
            in, while every row from the target point on has already shifted down (same
            rowShiftOffsetById mechanism) to make room for it. */}
        {isProjectSheetView && restorePreviewGap ? (
          <div
            className="pointer-events-none absolute flex items-center justify-center gap-1.5 rounded-[6px] border-2 border-dashed text-[11px] font-bold"
            style={{
              left: 0,
              top: colHeaderHeightPx + restorePreviewGap.topPx,
              width: tableTotalWidthPx,
              height: restorePreviewGap.heightPx,
              borderColor: "var(--brand-strong)",
              backgroundColor: "var(--brand-soft)",
              color: "var(--brand-strong)",
            }}
          >
            <Undo2 size={12} />
            {restorePreviewGap.name}
          </div>
        ) : null}

        {borderSegments.map((seg, i) => (
          <div
            key={i}
            className="pointer-events-none absolute"
            style={{ left: rowHeaderWidthPx + seg.left, top: colHeaderHeightPx + seg.top, width: seg.width, height: seg.height, backgroundColor: seg.color }}
          />
        ))}

        {/* A project's own copy never draws these on the sheet itself — the group's name is already
            shown once in the "Sections" checklist above, and repeating it as a floating label over
            every occurrence would just be clutter on what's meant to read like a finished document.
            The company template builder still shows them, since it's what's used to actually lay
            groups out. */}
        {isProjectSheetView
          ? null
          : groupOutlines.map((g) => (
              <div
                key={g.id}
                className="pointer-events-none absolute"
                style={{
                  left: rowHeaderWidthPx,
                  top: colHeaderHeightPx + g.top,
                  width: tableTotalWidthPx,
                  height: g.height,
                  border: `1.5px dashed ${g.hidden ? "var(--text-muted)" : "var(--brand-strong)"}`,
                  opacity: g.hidden ? 0.5 : 1,
                }}
              >
                <span
                  className="absolute -top-[9px] left-1 whitespace-nowrap rounded-[4px] px-1 text-[9px] font-bold"
                  style={{
                    backgroundColor: g.hidden ? "var(--panel-muted)" : "var(--brand-soft)",
                    color: g.hidden ? "var(--text-muted)" : "var(--brand-strong)",
                  }}
                >
                  {g.name}
                </span>
              </div>
            ))}

        {selectionOutline ? (
          <div
            className="pointer-events-none absolute"
            style={{
              left: rowHeaderWidthPx + selectionOutline.left,
              top: colHeaderHeightPx + selectionOutline.top,
              width: selectionOutline.width,
              height: selectionOutline.height,
              boxShadow: "inset 0 0 0 2px var(--brand-strong)",
            }}
          />
        ) : null}

        {/* Resizing (and the header strips it's confined to) is a builder-only affordance — a
            project's own copy shouldn't let someone drag the template's own layout bigger/smaller
            while working in what's meant to read like a finished, laid-out document. */}
        {isProjectSheetView ? null : (
          <>
            {colPrefixSums.slice(1, -1).map((x, i) => (
              <div
                key={i}
                onMouseDown={(e) => {
                  // Without this, dragging the handle also starts the browser's native text/content
                  // selection (the mouse-drag gesture browsers use to select text) — visually showing
                  // as neighboring cells' text getting highlighted while resizing, since a
                  // mousedown+drag over page content is exactly what triggers that native behavior.
                  e.preventDefault();
                  onColumnResizeStart(i, e.clientX);
                }}
                className="absolute top-0 z-10 w-[6px] -translate-x-1/2 cursor-col-resize"
                style={{ left: ROW_HEADER_WIDTH_PX + x, height: COL_HEADER_HEIGHT_PX }}
              />
            ))}
            {rowPrefixSums.slice(1, -1).map((y, i) => (
              <div
                key={i}
                onMouseDown={(e) => {
                  // Same native-text-selection suppression as the column resize handle above.
                  e.preventDefault();
                  onRowResizeStart(i, e.clientY);
                }}
                className="absolute left-0 z-10 h-[6px] -translate-y-1/2 cursor-row-resize"
                style={{ top: COL_HEADER_HEIGHT_PX + y, width: ROW_HEADER_WIDTH_PX }}
              />
            ))}
          </>
        )}
        </div>
        </div>
      </div>

      {colorPopover ? (
        <SpecsCellColorPopover
          isOpen
          anchorRect={colorPopover.anchorRect}
          currentColor={
            (colorPopover.kind === "bg"
              ? activeCell?.cell?.style?.bgColor
              : colorPopover.kind === "text"
                ? activeCell?.cell?.style?.textColor
                : activeCell?.cell?.style?.borderColor) ?? (colorPopover.kind === "text" ? "#000000" : "#FFFFFF")
          }
          companyColor={companyColor}
          onSelect={(hex) => {
            if (colorPopover.kind === "bg") {
              toggleStyle((s) => ({ ...s, bgColor: hex }));
            } else if (colorPopover.kind === "text") {
              toggleStyle((s) => ({ ...s, textColor: hex }));
            } else {
              // Picking a border color alone (without first toggling a T/R/B/L side on) should
              // visibly add a border, not silently set a color nothing is using yet — default to
              // all four sides when none are already enabled.
              toggleStyle((s) => {
                const hasAnySide = s.borderTop || s.borderRight || s.borderBottom || s.borderLeft;
                return {
                  ...s,
                  borderColor: hex,
                  ...(hasAnySide ? {} : { borderTop: true, borderRight: true, borderBottom: true, borderLeft: true }),
                };
              });
            }
          }}
          onClose={() => setColorPopover(null)}
        />
      ) : null}

      {headerContextMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={headerContextMenuRef}
              className="fixed z-[2000] w-[180px] overflow-hidden rounded-[8px] border py-1"
              style={{
                left: headerContextMenu.x,
                top: headerContextMenu.y,
                borderColor: "var(--glass-border)",
                backgroundColor: "var(--glass-bg-strong)",
                backdropFilter: "blur(24px) saturate(180%)",
                WebkitBackdropFilter: "blur(24px) saturate(180%)",
                boxShadow: "var(--shadow-glass)",
              }}
            >
              <div className="px-3 py-2">
                <label className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  {headerContextMenu.axis === "row" ? "Row Height (px)" : "Column Width (px)"}
                </label>
                <form
                  className="mt-1 flex items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem("size") as HTMLInputElement | null;
                    const value = Number.parseInt(input?.value ?? "", 10);
                    if (Number.isFinite(value)) applyHeaderResize(headerContextMenu.axis, headerContextMenu.index, value);
                    setHeaderContextMenu(null);
                  }}
                >
                  <input
                    name="size"
                    type="number"
                    autoFocus
                    min={headerContextMenu.axis === "row" ? MIN_ROW_HEIGHT_PX : MIN_COL_WIDTH_PX}
                    defaultValue={Math.round(
                      headerContextMenu.axis === "row" ? safeRowHeights[headerContextMenu.index] ?? 0 : safeColumnWidths[headerContextMenu.index] ?? 0,
                    )}
                    className="h-7 w-20 rounded-[6px] border px-2 text-[12px] outline-none"
                    style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                  />
                  <button
                    type="submit"
                    className="h-7 rounded-[6px] border px-2 text-[11px] font-bold hover:brightness-95"
                    style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                  >
                    Apply
                  </button>
                </form>
              </div>
              {headerContextMenu.axis === "row" ? (
                <>
                  <div className="my-1 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
                  <button
                    type="button"
                    onClick={() => {
                      applyChange(insertRow(liveGrid, headerContextMenu.index), true);
                      setHeaderContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12px] hover:brightness-95"
                    style={{ color: "var(--text-main)" }}
                  >
                    <Plus size={13} />
                    Add Row Above
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      applyChange(insertRow(liveGrid, headerContextMenu.index + 1), true);
                      setHeaderContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12px] hover:brightness-95"
                    style={{ color: "var(--text-main)" }}
                  >
                    <Plus size={13} />
                    Add Row Below
                  </button>
                </>
              ) : null}
              {headerContextMenu.axis === "row"
                ? (() => {
                    const existingGroup = findRowGroupForRow(expandedGroups, headerContextMenu.index);
                    let rangeStart = headerContextMenu.index;
                    let rangeEnd = headerContextMenu.index;
                    if (selection) {
                      const rect = normalizeRect(selection);
                      if (headerContextMenu.index >= rect.minRow && headerContextMenu.index <= rect.maxRow && rect.minRow !== rect.maxRow) {
                        rangeStart = rect.minRow;
                        rangeEnd = rect.maxRow;
                      }
                    }
                    return (
                      <>
                        <div className="my-1 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
                        <div className="px-3 py-2">
                          <label className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                            {existingGroup ? "Rename Group" : "Link Rows as Group"}
                          </label>
                          <form
                            className="mt-1 flex items-center gap-1.5"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const input = e.currentTarget.elements.namedItem("groupName") as HTMLInputElement | null;
                              const name = input?.value ?? "";
                              if (existingGroup) renameGroup(existingGroup.id, name);
                              else linkRowsAsGroup(rangeStart, rangeEnd, name);
                              setHeaderContextMenu(null);
                            }}
                          >
                            <input
                              name="groupName"
                              type="text"
                              autoFocus
                              defaultValue={existingGroup?.name ?? ""}
                              placeholder="e.g. Handle Details"
                              className="h-7 w-full min-w-0 rounded-[6px] border px-2 text-[12px] outline-none"
                              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                            />
                            <button
                              type="submit"
                              className="h-7 shrink-0 rounded-[6px] border px-2 text-[11px] font-bold hover:brightness-95"
                              style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                            >
                              {existingGroup ? <Link2 size={12} /> : "Link"}
                            </button>
                          </form>
                        </div>
                        {(() => {
                          // Lets a highlighted row/range be folded into a DIFFERENT group that
                          // already exists, instead of only ever creating a new one — the row's
                          // range is unioned into that group's own range (see addRowsToGroup's own
                          // comment on why a group stays a single contiguous block).
                          const otherGroups = liveGrid.groups.filter((g) => g.id !== existingGroup?.id);
                          if (otherGroups.length === 0) return null;
                          return (
                            <>
                              <div className="my-1 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
                              <div className="px-3 pb-1 pt-2">
                                <label className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                                  Add to Existing Group
                                </label>
                              </div>
                              {otherGroups.map((g) => (
                                <button
                                  key={g.id}
                                  type="button"
                                  onClick={() => {
                                    addRowsToExistingGroup(g.id, rangeStart, rangeEnd);
                                    setHeaderContextMenu(null);
                                  }}
                                  className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12px] hover:brightness-95"
                                  style={{ color: "var(--text-main)" }}
                                >
                                  <Link2 size={13} />
                                  {g.name}
                                </button>
                              ))}
                            </>
                          );
                        })()}
                        {existingGroup ? (
                          <>
                            <div className="my-1 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
                            <button
                              type="button"
                              onClick={() => {
                                unlinkGroup(existingGroup.id);
                                setHeaderContextMenu(null);
                              }}
                              className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12px] hover:brightness-95"
                              style={{ color: "var(--danger-strong)" }}
                            >
                              <Link2Off size={13} />
                              Remove Group
                            </button>
                          </>
                        ) : null}
                      </>
                    );
                  })()
                : null}
              <div className="my-1 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
              <button
                type="button"
                onClick={() => {
                  if (headerContextMenu.axis === "row") applyChange(removeRow(liveGrid, headerContextMenu.index), true);
                  else applyChange(removeColumn(liveGrid, headerContextMenu.index), true);
                  setHeaderContextMenu(null);
                }}
                className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12px] hover:brightness-95"
                style={{ color: "var(--danger-strong)" }}
              >
                <Trash2 size={13} />
                {headerContextMenu.axis === "row"
                  ? `Delete Row ${headerContextMenu.index + 1}`
                  : `Delete Column ${getColumnLetter(headerContextMenu.index)}`}
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

// Only re-syncs its DOM content from `text` when it doesn't currently hold real focus — a
// contentEditable div whose children are re-driven on every keystroke fights the browser's own
// cursor position (a well-known React+contentEditable problem). Committing happens on blur
// (clicking away), not per keystroke.
function SpecsCellTextArea({
  text,
  style,
  isFocused,
  onFocusCell,
  onBlurCommit,
}: {
  cellKey: string;
  text: string;
  style: SpecsCellStyle;
  isFocused: boolean;
  onFocusCell: () => void;
  onBlurCommit: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isFocused) return;
    if (ref.current && ref.current.textContent !== text) {
      ref.current.textContent = text;
    }
  }, [text, isFocused]);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onFocus={onFocusCell}
      onBlur={(e) => onBlurCommit(e.currentTarget.textContent ?? "")}
      // Enter always inserts a new line (same as Shift+Enter) — the cell only commits/exits on blur
      // (clicking away), so no keyboard shortcut is needed or wired here to leave the cell.
      // The row height never grows to fit typed content — this div's parent wrapper (in the parent
      // render) is a fixed-height flex column with overflow:hidden, so text that overflows the row's
      // configured height simply clips instead of pushing the row taller. That wrapper also owns
      // vertically aligning this div within the cell (see its own comment for why capping a
      // table-cell's block child with maxHeight alone doesn't reliably work in Chrome) — leaving this
      // div's own height fully natural is what lets that wrapper's flexbox centering/bottom-alignment
      // actually see a smaller-than-the-cell size to align.
      className="whitespace-pre-wrap break-words px-2 py-0.5 outline-none"
      style={{
        fontWeight: style.bold ? 700 : 400,
        fontSize: `${style.fontSize ?? DEFAULT_CELL_FONT_SIZE_PX}px`,
        textAlign: style.align ?? "left",
        color: style.textColor ?? "var(--text-main)",
      }}
    />
  );
}

