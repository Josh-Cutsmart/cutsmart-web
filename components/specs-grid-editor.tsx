"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { SYSTEM_QUOTE_FONT_OPTIONS } from "@/lib/quote-font-options";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import {
  Bold,
  Underline,
  CheckSquare,
  Check,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  ChevronDown,
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
  RefreshCw,
  Redo2,
  TableCellsMerge,
  TableCellsSplit,
  Undo2,
} from "lucide-react";
import {
  type SpecsGrid,
  type SpecsGridSelection,
  type SpecsCellStyle,
  type SpecsCell,
  type SpecsRowGroup,
  type SpecsPageSize,
  type SpecsTextRun,
  type SpecsRowGroupEditableFields,
  type SpecsGroupRule,
  type SpecsGroupZone,
  genSpecsGroupRuleId,
  genSpecsZoneId,
  isRowWithinGroupZone,
  getCellRuns,
  runsToPlainText,
  normalizeTextRuns,
  getCellSpan,
  computeBorderSegments,
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
  importLinkedQuoteTextIntoZone,
  getEditableZoneText,
  getExpandedRowGroups,
  findRowGroupForRow,
  SPECS_PAGE_SIZES,
  SPECS_PAGE_MARGIN_MM,
  getSpecsPageUsableWidthPx,
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
  // Only meaningful alongside showGroupVisibilityPanel: the host page's OWN fixed header height (px)
  // — this editor's own toolbar is also `position: fixed` (see its own comment for why) and pins
  // itself right below that header instead of underneath it. Defaults to 0 (no host header to clear).
  toolbarFixedTopPx?: number;
  // Also only meaningful alongside showGroupVisibilityPanel: how much room (px) the host page wants
  // reserved at the RIGHT edge of THIS EDITOR'S OWN TOOLBAR specifically — e.g. the width of a title
  // label the host page renders at that same fixed height, alongside its own toolbar content — so
  // the toolbar's own buttons don't render underneath it. Static/prop-driven, not measured, and
  // deliberately does NOT affect the canvas/mock-page below (which stays at its own natural,
  // centered width regardless) — only the toolbar's own bounds move.
  toolbarFixedRightPx?: number;
  // Same idea as toolbarFixedRightPx, mirrored to the LEFT.
  toolbarFixedLeftPx?: number;
  // Turns a named row-group into a priced, toggleable "Quote Extra" — the group create/rename
  // popover (right-click a row → "Link Rows as Group"/"Rename Group") gains a Price field and an
  // "Included by default" checkbox alongside the existing Name field, and the "Sections" checklist
  // shows each group's price next to its name. Off by default (Specifications has no pricing concept
  // at all) — purely additive, no behavior change for any existing caller that doesn't pass this.
  groupsSupportPricing?: boolean;
  // Suppresses the inline "Sections:" toolbar row entirely — used when the host page renders its own
  // dedicated sidebar for the same show/hide toggles (the Quote tab's extras sidebar) so the two
  // don't duplicate each other. The company template builder ignores this (it has no sidebar of its
  // own to defer to) and always shows the inline bar.
  hideSectionsBar?: boolean;
  // Shows the "Mark for Confirmation" toolbar button and the resulting Pending/Yes/No cell overlay
  // — a client-confirmation workflow that only makes sense on Specifications (where a client
  // confirms individual answers), not on Quote. Off by default so a caller has to opt in
  // explicitly; the Specifications instance passes true, the Quote instance leaves it unset.
  allowConfirmationMarking?: boolean;
  // Company roles offered in the group editor modal's "Allow editable by" checklist — omit (or pass
  // []) to hide that section entirely, e.g. in the company-settings template builder, where there's
  // no per-viewer permission concept yet (it only starts mattering once cloned into a real project).
  companyRoleOptions?: { id: string; name: string }[];
  // Sales Product names (Company Settings > Sales > PRODUCT, filtered to "Incl in Sales") offered
  // in the group editor modal's Rules section as the "IF <Product>" dropdown — omit (or pass []) to
  // leave that dropdown empty. Both the company template builder and a live project's Quote/Specs
  // editor pass the same company-wide list; only a project actually has any of them selected.
  productOptions?: string[];
  // Whether the CURRENT viewer is allowed to edit a given group's own rows — omit to leave every
  // group fully editable (the default, and the only behavior for every existing caller). The host
  // page owns the actual policy (role lookup, owner/admin bypass, etc.); this component only ever
  // asks "yes or no" and, when the answer is no, makes that group's cells read-only.
  canEditSpecsGroup?: (group: SpecsRowGroup) => boolean;
  // A blank cell (no text, no image) whose row isn't part of any group becomes fully inert for
  // EVERY viewer when this is on — not just read-only like canEditSpecsGroup's per-role lock (which
  // owner/admin always bypass), genuinely unclickable/unselectable for anyone, since it isn't a
  // role-based permission at all: it's a structural rule about the template's own layout (only
  // Quote's live project sheet sets this — see its own mount in app/(app)/projects/[projectId]/page.tsx).
  // A cell that already has content, or sits in a group's rows, is completely unaffected either way.
  lockUngroupedBlankCells?: boolean;
  // Draws a persistent solid border around every VISIBLE group whose rows the current viewer is
  // allowed to edit (per canEditSpecsGroup — a group with no editableByRoleIds restriction always
  // counts as editable) — purely a screen affordance so it's obvious at a glance which sections of a
  // live document are actually yours to work on. Deliberately a different, quieter look than the
  // company template builder's own dashed+labeled groupOutlines (which shows EVERY group, including
  // locked/hidden ones, since that's a layout tool, not a "what can I touch" indicator) — and, since
  // this only ever renders in this on-screen editor, it never shows up in Print/Download PDF, which
  // builds its output through a completely separate code path (buildSpecsGridPdfBlob) that never
  // touches this component at all. Only Quote's live project sheet sets this.
  showEditableGroupBorders?: boolean;
  // Suppresses the blue selection-ring overlay (selectionOutline) that would otherwise be drawn
  // around whatever cell/range is currently selected — clicking/typing into a cell still works
  // exactly the same either way, this just stops it from visibly looking "highlighted" while you do
  // it. Only Quote's live project sheet sets this; every other caller keeps the ring.
  hideCellSelectionOutline?: boolean;
  // True once a client-confirmation link has been created for this project's specs sheet (see
  // specsShareStatus in app/(app)/projects/[projectId]/page.tsx) — locks the ENTIRE sheet against
  // deletion/hiding/text-edits the same way an individual client-answered row already is (see
  // isRowAnsweredByClient's own comment), not just the specific rows/sections that happen to have
  // an answer yet. The client could be looking at (or about to answer) any part of the sheet the
  // moment it's sent, not only cells already answered — only Specifications' own live project sheet
  // ever sets this; Quote has no client-confirmation concept.
  isSentToClient?: boolean;
  // True while a historical SAVED version is open (not the live sheet/grid) — gates the
  // confirmable-cell Yes/No/Pending status overlay below. The client's actual answer only ever
  // gets written onto the specific version document that was bound at send time (see
  // app/api/specs-share/[shareId]/answer/route.ts), never back onto the live sheet, so the live
  // grid's own copy of confirmedYes/confirmedAt is permanently stale/meaningless the moment a
  // version diverges from it — showing "Pending" there forever, regardless of the real answer,
  // would be actively misleading. Only a saved version's own data is ever current.
  isViewingSavedVersion?: boolean;
  // Scales the whole white page down to fit the canvas's own available width by default (the page
  // is sized to real physical mm dimensions, which routinely overflows a phone screen), with a
  // self-contained pinch-to-zoom/pan on top to go in closer — independent of the browser's own
  // page zoom, which the host app disables globally elsewhere (see app/layout.tsx's viewport
  // config) to stop mobile Safari auto-zooming into small inputs. Only the two project-sheet
  // callers set this, and only while their own host page is in its mobile/compact layout.
  fitToViewportOnMobile?: boolean;
  // Extra bottom padding on the grey canvas itself (below the mock page), reserved so a host
  // page's OWN floating action bar can float over this canvas's own background instead of a
  // separate, unstyled section of the host page's background — which reads as a visible seam
  // where the two backgrounds don't match. Only the two project-sheet callers set this.
  canvasBottomInsetPx?: number;
  // fitToViewportOnMobile only: the host page's own fixed title bar height ABOVE this component
  // (quoteHeaderHeight/specsHeaderHeight, currently 56 for both) — this component has no way to
  // know that on its own, since the host reserves that space itself (paddingTop on the wrapper
  // around this whole component), not inside anything rendered here. Used, together with
  // PROJECT_TOOLBAR_HEIGHT_PX/canvasBottomInsetPx (both already known inside this component), to
  // work out how much real vertical room the sheet has to fit in — see sheetFitScale's own comment
  // for why that matters. A missing/undefined value just means "assume there's no host header,"
  // which for every caller that also doesn't set fitToViewportOnMobile is already correct (unused).
  mobileTopOffsetPx?: number;
  // Hover sync with the host page's own "Sections" bubble list (only the two project-sheet callers
  // set either of these — every other caller leaves both undefined, a no-op on both sides).
  // Deliberately ASYMMETRIC, not a plain two-way mirror: hovering a bubble highlights BOTH the
  // bubble itself and this group's rows here (`highlightedGroupId`, rendered as a new overlay
  // below), but hovering a group's rows here only highlights the matching bubble back on the host
  // page — it never highlights itself. So `onHoveredGroupChange` reports this component's own
  // internal hover (hoveredGroupId, derived from hoveredRowIndex — already tracked for the
  // drag-handle's own fade-in) up to the page, but the page is expected to feed a SEPARATE,
  // bubble-hover-only value back in as `highlightedGroupId`, not this same one echoed back.
  highlightedGroupId?: string | null;
  onHoveredGroupChange?: (groupId: string | null) => void;
  // The Quote TEMPLATE grid — passed ONLY by Company Settings' Specs template call site. Its mere
  // presence is what gates the zone right-click "Link to Quote Groups" menu/picker (see
  // zoneContextMenu below and SpecsGroupZone.linkedQuoteGroups' own comment on why name and not id):
  // links are deliberately only ever authored here, in the template builder, never inside a live
  // project. Read from, never written to — linking is strictly one-way.
  linkedQuoteSourceGrid?: SpecsGrid;
  // The project's own LIVE Quote grid — passed ONLY by the project page's Specs call site. Its mere
  // presence is what gates the on-sheet "Import from Quote" button next to any group whose editable
  // zone already has linkedQuoteGroups set (inherited from the template at clone time) — this is the
  // ONLY thing that happens per-project: refreshing a zone's content from its already-configured
  // links' current text, never changing which groups/zones are linked.
  quoteGridForLinkedPull?: SpecsGrid;
  // Marks this instance as the Group Settings modal's own embedded, cropped preview of a single
  // group's rows (used for marking "zones" — see SpecsGroupZone) rather than a normal sheet. Nothing
  // typed/edited here is ever meant to persist on its own (the host always passes a no-op onChange),
  // so this: (1) forces every cell read-only regardless of any other editability logic, (2) skips
  // mounting the global Ctrl+C/V/Z/Y keydown listener entirely — safe to do since there's nothing of
  // this instance's own to undo/copy/paste, and necessary because that listener isn't scoped to its
  // own instance, so a SECOND one mounted (this preview, nested inside the first/outer instance's own
  // render tree) would otherwise also fire on keystrokes meant for the outer sheet, (3) strips every
  // bit of chrome that doesn't matter for a tiny, throwaway, read-only crop (toolbar, row/column
  // headers, physical-page sizing floor, resize handles) so the preview shows only the group's own
  // cells, not a page-sized canvas around a handful of rows.
  zonePreviewMode?: boolean;
  // Only meaningful alongside zonePreviewMode: reports the row range of the CURRENT selection inside
  // this instance (or null once nothing's selected) every time it changes — row-only, same shape as
  // SpecsGroupZone itself, and already relative to THIS instance's own `value` grid, which is already
  // cropped to one group's rows. The host uses this to drive its own "Mark Selection as Editable
  // Zone" button rendered ABOVE the preview (not a context-menu item inside it, since the row-header
  // gutter itself is hidden in this mode along with everything else in point (3) above).
  onSelectionRangeChange?: (range: { minRow: number; maxRow: number } | null) => void;
  // Only meaningful alongside zonePreviewMode: zones to render as a labeled outline overlay (same
  // visual treatment as the template builder's own groupOutlines), so an already-marked zone is
  // visible in the preview even though zones aren't SpecsRowGroup entries in `value.groups`.
  previewZones?: SpecsGroupZone[];
  // Only meaningful alongside zonePreviewMode: called with (zoneId, screen x, screen y) when the user
  // right-clicks a cell that falls inside one of `previewZones` — a row OUTSIDE any zone does nothing
  // (there's nothing to configure there in this mode). The host uses this to open its own "Link to
  // Quote Groups" menu/picker for that specific zone, anchored at the click position — this instance
  // never renders that menu itself, since the picker needs `linkedQuoteSourceGrid` (a prop of the
  // OUTER/host instance, not this cropped nested one).
  onZoneContextMenu?: (zoneId: string, x: number, y: number) => void;
  // fitToViewportOnMobile only: fires whenever this sheet's own pinch-zoom goes above/back to 1x —
  // see its call site's own comment (near sheetZoom) for why the host page needs this at all (its
  // mobile swipe-to-open-a-drawer gesture can't otherwise tell a pan across zoomed-in content apart
  // from an ordinary drag). Pass a stable function (e.g. a plain useState setter) — see that
  // comment for why an inline arrow redefined every render would still work correctly here, but a
  // setState function identity is the simplest way to guarantee it.
  onSheetZoomedAwayFromEdge?: (zoomedAway: boolean) => void;
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

type GroupOutline = { id: string; name: string; hidden: boolean; top: number; height: number };

// One full-width horizontal band per row group, from the same rowTops used for the border overlay —
// rendered as a dashed outline + label so it's clear which rows a group covers, in both the builder
// (where groups are created) and a project's own copy (where they're only shown/hidden). Takes an
// already-expanded groups list (getExpandedRowGroups) so the outline never cuts through a merge.
// Width/left are the table's own full width, applied by the caller — row groups always span it.
// rowBottoms is normally the exact same array as rowTops — see computeBorderSegments' own comment
// on the same parameter for why they can differ, and when.
function computeGroupOutlines(groups: SpecsRowGroup[], rowTops: number[], rowBottoms: number[]): GroupOutline[] {
  return groups
    .filter((g) => g.endRow + 1 < rowTops.length)
    .map((g) => ({
      id: g.id,
      name: g.name,
      hidden: Boolean(g.hidden),
      top: rowTops[g.startRow],
      height: rowBottoms[g.endRow + 1] - rowTops[g.startRow],
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
// The project-view toolbar's own real rendered height — matches the plain static spacer div that
// reserves its flow space further down (position:fixed elements take up zero space on their own),
// and the host page's own shared blur backdrop height (see its comment — "56 + 48" there needs to
// stay in sync with this number). 48 (its p-2 padding + h-8 buttons) undercounted its own
// borderBottom: for an auto-height element (no explicit height set), a border always adds to the
// rendered size on top of content+padding regardless of box-sizing — box-sizing only changes how an
// EXPLICIT height gets allocated, and this one has none — so the real height is 49, and reserving
// only 48 left a 1px sliver of the page's own base background showing through as a visible seam
// between the toolbar and the canvas below it.
const PROJECT_TOOLBAR_HEIGHT_PX = 49;
// See growRowForCellHeight's own comment — filters out sub-pixel measurement noise (e.g. from a cell
// merely losing focus) so a row only actually grows for a genuine extra wrapped line, not a rounding
// fluctuation of a couple px.
const GROW_ROW_TOLERANCE_PX = 4;
const GRIDLINE_COLOR = "#D4D4D4";
const HEADER_BG = "#F3F3F3";
const HEADER_TEXT = "#666666";
// A project's own copy has no row-number column, and deliberately reserves NO table width for the
// hover "+ add row"/"- remove row" buttons either — they're rendered as a floating overlay strip that
// hangs off the left edge of the sheet instead (see the row-actions overlay in the render body), so
// the data columns always start flush at x=0 and line up evenly with the mock page's own left edge
// rather than being pushed over by a reserved gutter column. This is just that overlay strip's width.
// Wide enough to fully contain both 16px buttons + their gap/margin (41px of real content) without
// justify-content:center overflowing past the strip's own edge — a narrower value here previously let
// the "-" button's rendered box spill a couple px past this strip and into the drag handle's own
// zone just to its left, which is exactly what looked like the two overlapping.
const ADD_ROW_GUTTER_PX = 44;
// The group drag-handle strip sits just outside the +/- strip's own left edge, same reasoning as
// ADD_ROW_GUTTER_PX itself — a real reserved column would misalign the sheet's data columns from the
// mock page's print margins. A small explicit gap (GROUP_DRAG_HANDLE_GAP_PX) is kept between the two,
// on top of ADD_ROW_GUTTER_PX now being sized to not overflow, so the handle never visually touches
// the "-" button even at the strip's own rendered edge.
const GROUP_DRAG_HANDLE_WIDTH_PX = 20;
const GROUP_DRAG_HANDLE_GAP_PX = 4;

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

// Bold/underline's own whole-CELL(s) analogue of mapSelectedCells above — every cell touched by the
// selection gets ALL of its runs flipped together (not just whatever's highlighted, since a grid
// selection isn't a text selection). "Turn on" vs "turn off" is decided once for the whole selection
// (on unless every touched run already has it) rather than per-cell, so a multi-cell selection lands
// in one consistent end state instead of some cells landing on and others off.
function mapSelectedCellsRunFormat(grid: SpecsGrid, sel: SpecsGridSelection, key: "bold" | "underline"): SpecsGrid {
  const rect = normalizeRect(sel);
  let allAlreadyOn = true;
  outer: for (let r = rect.minRow; r <= rect.maxRow; r += 1) {
    for (let c = rect.minCol; c <= rect.maxCol; c += 1) {
      const cell = grid.rows[r]?.cells[c];
      if (!cell) continue;
      if (!getCellRuns(cell).every((run) => Boolean(run[key]))) {
        allAlreadyOn = false;
        break outer;
      }
    }
  }
  const nextValue = !allAlreadyOn;
  const rows = grid.rows.map((row, r) => {
    if (r < rect.minRow || r > rect.maxRow) return row;
    const cells = row.cells.map((cell, c) => {
      if (!cell || c < rect.minCol || c > rect.maxCol) return cell;
      const runs = normalizeTextRuns(getCellRuns(cell).map((run) => ({ ...run, [key]: nextValue })));
      return { ...cell, runs, text: runsToPlainText(runs) };
    });
    return { ...row, cells };
  });
  return { pageSize: grid.pageSize, columnWidths: grid.columnWidths, groups: grid.groups, deletedGroups: grid.deletedGroups, rows };
}

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Runs -> the actual DOM a cell's contentEditable div holds, both for display (unfocused) and as the
// starting point once editing begins. `<b>`/`<u>` (not CSS) so the browser's own native bold/underline
// commands (execCommand, used below) recognize and can toggle them, and so parseHtmlToRuns' own
// tag-based reading stays the exact inverse of this. A run's embedded `\n` becomes a literal <br> —
// see SpecsCellTextArea's own onKeyDown for why every line break ends up represented that way rather
// than the browser's own inconsistent (and, for reading back out, much messier) per-paragraph <div>
// wrapping.
function runsToHtml(runs: SpecsTextRun[]): string {
  return runs
    .map((run) => {
      const escaped = escapeHtmlText(run.text).replace(/\n/g, "<br>");
      let html = escaped;
      if (run.underline) html = `<u>${html}</u>`;
      if (run.bold) html = `<b>${html}</b>`;
      return html;
    })
    .join("");
}

// The exact inverse of runsToHtml — walks a cell's own contentEditable DOM (after the browser's own
// execCommand/typing has potentially changed it) back into plain SpecsTextRun data. Recognizes <b>/
// <strong>/<u> tags plus the equivalent inline CSS (execCommand implementations differ slightly by
// browser/version) rather than trusting only one form, and treats <br> as a literal line break —
// matching what runsToHtml produced them from in the first place.
function parseHtmlToRuns(html: string): SpecsTextRun[] {
  const container = document.createElement("div");
  container.innerHTML = html;
  const runs: SpecsTextRun[] = [];
  const walk = (node: Node, bold: boolean, underline: boolean) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (text) runs.push({ text, ...(bold ? { bold: true } : {}), ...(underline ? { underline: true } : {}) });
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "br") {
        runs.push({ text: "\n" });
        return;
      }
      const fontWeight = el.style?.fontWeight;
      const isBoldTag = tag === "b" || tag === "strong" || fontWeight === "bold" || fontWeight === "700" || Number(fontWeight) >= 700;
      const isUnderlineTag = tag === "u" || Boolean(el.style?.textDecoration?.includes("underline"));
      walk(el, bold || isBoldTag, underline || isUnderlineTag);
    });
  };
  walk(container, false, false);
  return normalizeTextRuns(runs);
}

// Applies a native bold/underline toggle to whatever's currently highlighted inside `node` — returns
// false (doing nothing) when there's no real, non-collapsed selection inside it, so the caller can
// fall back to the whole-cell(s) toggle instead. This is what makes "select entire cell -> affects
// everything, highlight part of it -> affects only that part" work: same button, different browser
// selection state at the moment it's clicked. execCommand is deprecated but remains the only way to
// get the browser's own selection-aware bold/underline splitting (partial-run wrapping/unwrapping,
// merging adjacent identical tags, etc.) without reimplementing that logic by hand.
function applyFormatCommandToSelection(node: HTMLElement, key: "bold" | "underline"): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!node.contains(range.commonAncestorContainer)) return false;
  document.execCommand(key === "bold" ? "bold" : "underline");
  return true;
}

const toolbarButtonStyle = { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" } as const;
const toolbarButtonActiveStyle = { borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" } as const;
const toolbarDangerStyle = { borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" } as const;

// A tiny square glyph standing in for the old 4-letter T/R/B/L toggle row on the toolbar's own
// "Border" button — each side of the square renders darker only while that side is actually turned
// on for the active cell, so the button itself doubles as a live preview of the current border
// state without needing to open the popover just to check.
function BorderStateIcon({ style }: { style: SpecsCellStyle }) {
  const on = "var(--text-main)";
  const off = "var(--glass-border)";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0" aria-hidden>
      <line x1="1" y1="1" x2="13" y2="1" stroke={style.borderTop ? on : off} strokeWidth="2" />
      <line x1="13" y1="1" x2="13" y2="13" stroke={style.borderRight ? on : off} strokeWidth="2" />
      <line x1="1" y1="13" x2="13" y2="13" stroke={style.borderBottom ? on : off} strokeWidth="2" />
      <line x1="1" y1="1" x2="1" y2="13" stroke={style.borderLeft ? on : off} strokeWidth="2" />
    </svg>
  );
}

const ALIGN_OPTIONS = [
  { value: "left" as const, label: "Align left", Icon: AlignLeft },
  { value: "center" as const, label: "Align center", Icon: AlignCenter },
  { value: "right" as const, label: "Align right", Icon: AlignRight },
];
const VALIGN_OPTIONS = [
  { value: "top" as const, label: "Align top", Icon: AlignVerticalJustifyStart },
  { value: "middle" as const, label: "Align middle", Icon: AlignVerticalJustifyCenter },
  { value: "bottom" as const, label: "Align bottom", Icon: AlignVerticalJustifyEnd },
];

// A small floating pill-shaped button pinned outside the sheet's own right edge — shared by
// "Import from Quote" (next to a selected linked editable zone) and "Mark for Confirmation" (next
// to whatever cell(s) are currently selected). Only one instance is ever shown per caller at a time
// (driven by `target` going null when there's nothing to anchor it to), and needs to animate OUT
// with the same "pop away" ghost-portal technique the desktop floating action pill uses for a
// button leaving the bar (FloatingBarSlot, defined in the project page, and its own
// .floating-bar-slot-pop class in globals.css — reused here as-is) rather than just vanishing the
// instant the target disappears. A plain conditional render can't animate its own removal (React
// deletes the node the instant it's gone), so this keeps rendering the OUTGOING button's last known
// on-screen box/content as a position:fixed portal snapshot for exactly as long as the pop-away
// animation needs, while the REAL button swaps straight to wherever `target` points next (or
// disappears, if null) underneath it.
type FloatingSideButtonTarget = {
  // Identity used to tell "the same button, just repositioning/updating its own content" (no pop —
  // e.g. Mark for Confirmation tracking the selection from cell to cell) apart from "a genuinely
  // different button taking its place, or nothing at all" (pops away then in — e.g. Import from
  // Quote switching between two different zones). Callers with only ever one possible button (Mark
  // for Confirmation) can just pass a constant.
  id: string;
  leftPx: number;
  // The button's own TOP edge — a caller wanting it vertically centered over some span (e.g. Mark
  // for Confirmation, across a multi-row selection) must bake that offset into this value itself
  // (topPx - half the button's own height), NOT via a CSS transform: the glass-bubble-pop entrance
  // class below animates `transform` (scale) for its first 380ms, which would otherwise clobber a
  // separate transform applied here for centering — the button would render unshifted (sitting low)
  // for the whole pop-in, then visibly snap up into place the instant it finishes.
  topPx: number;
  content: ReactNode;
};

type MobileLongPressAction = { label: string; title: string; onClick: () => void } | null;

// Mobile's own equivalent of a per-cell floating desktop button (FloatingSideButton above) — used
// by both "Mark for Confirmation" and "Import from Quote": a long-press on an eligible cell opens a
// small anchored dropdown with the action, instead of a floating pill always hovering nearby (see
// each call site's own desktop button, gated !fitToViewportOnMobile, for why — mirrors
// FloatingBarSlot/useLongPress's own established desktop-hover vs mobile-hold split elsewhere in
// this app). A plain short tap still just selects the cell as normal; only a sustained hold opens
// the menu. One hook call per ACTION (not per cell) — makeHandlers is a plain factory, not a hook
// itself, so calling it fresh for each eligible cell inside the render loop is safe, same
// "one hook call per list" convention lib/use-long-press.ts's own useLongPress already establishes.
function useMobileCellLongPressMenu(setSelection: (sel: SpecsGridSelection) => void) {
  const PRESS_MS = 500;
  const MOVE_CANCEL_PX = 10;
  // How long a pending press is ever trusted before onMouseDownCapture starts treating it as
  // abandoned — see that handler's own comment.
  const STALE_MS = PRESS_MS + 1000;
  const MENU_CLOSE_MS = 180;

  // Tracked as a ref (not state) since it's pure interaction bookkeeping for one in-progress touch
  // gesture, not anything that should ever trigger a re-render on its own.
  const pressRef = useRef<{
    row: number;
    col: number;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
    fired: boolean;
    // The cell's own real contentEditable div (if it has one) — see onTouchStart's own comment for
    // why its native magnifier/callout gets suppressed directly on THIS element, separately from
    // the ancestor <td>'s own user-select/touch-callout suppression. Restored (removed) in every
    // exit path (clearPending below), regardless of outcome.
    editableEl: HTMLElement | null;
    // When this press started (Date.now()) — see onMouseDownCapture's own comment for why this
    // exists: a safety net against this ref ever getting stuck set forever.
    startedAt: number;
  } | null>(null);

  // Position + the already-resolved action for the currently-open mobile dropdown — null when
  // fully closed. onConfirm already wraps the caller's own onClick with closeMenu (see makeHandlers
  // below), so a caller never needs to close this itself.
  const [menu, setMenu] = useState<{ x: number; y: number; label: string; title: string; onConfirm: () => void } | null>(null);
  // True for exactly the pop-away animation's own duration right after a close is triggered — the
  // menu stays MOUNTED (menu itself only clears once this window ends) so it has a real element to
  // animate closed instead of just vanishing; see closeMenu below.
  const [menuClosing, setMenuClosing] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Plays the menu's own pop-AWAY (floating-bar-slot-pop, the same class/duration Import from
  // Quote's OWN desktop ghost uses elsewhere — no ghost-portal trick needed here, unlike that one:
  // this menu is already portaled straight to <body> with nothing clipping it and never
  // repositions mid-life, so the one real element can just play its own exit animation in place
  // before unmounting) instead of vanishing the instant it's dismissed.
  const closeMenu = () => {
    setMenu((current) => {
      if (!current) return current;
      setMenuClosing(true);
      window.setTimeout(() => {
        setMenu(null);
        setMenuClosing(false);
      }, MENU_CLOSE_MS);
      return current;
    });
  };

  useEffect(() => {
    if (!menu || menuClosing) return;
    const onPointerDown = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [menu, menuClosing]);

  // Single exit path for an in-progress press, used by every one of makeHandlers' own handlers
  // below — always restores the magnifier/callout suppression (see pressRef's own comment on
  // editableEl) so a cancelled/finished press never leaves a cell's own text permanently
  // unselectable, unlike an earlier version of this that only restored it from onTouchEnd/
  // onTouchCancel, silently skipping the restore whenever a press was cancelled by movement instead.
  const clearPending = () => {
    const pending = pressRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.editableEl?.style.removeProperty("-webkit-user-select");
    pending.editableEl?.style.removeProperty("-webkit-touch-callout");
    pressRef.current = null;
  };

  // row/col: mirrors the one relevant branch of whatever mousedown-driven select this gesture is
  // deferring (see onTouchStart's own comment) — used for the plain single-cell select a short tap
  // replays on release, and as this press's own identity for the staleness/cleanup bookkeeping
  // above. onPressComplete is called once the hold crosses PRESS_MS without enough movement to
  // cancel — return the action to show in the dropdown, or null for "nothing eligible right now"
  // (e.g. computed state changed between touchstart and the hold completing), in which case no
  // dropdown opens at all.
  const makeHandlers = (row: number, col: number, onPressComplete: () => MobileLongPressAction) => ({
    // Capture phase, same node as the plain onMouseDown it's paired with at each call site — fires
    // FIRST and, if a touch-originated press on THIS cell is still pending a long-press decision,
    // swallows the mousedown outright via stopImmediatePropagation so the normal select/focus logic
    // below never runs for it. stopPropagation alone would NOT be enough here — it only stops the
    // event reaching OTHER nodes, not a second listener already registered on this SAME node. Only
    // ever relevant on mobile (a real mouse never leaves a pending ref behind, since only
    // onTouchStart below ever creates one).
    onMouseDownCapture: (e: ReactMouseEvent<HTMLElement>) => {
      const pending = pressRef.current;
      if (!pending) return;
      // Safety net: this ref is ONLY ever meant to be set for the brief window of one in-progress
      // touch gesture, cleared the moment it ends. If that somehow never happened for some rare
      // browser/gesture edge case, it would otherwise stay stuck set FOREVER — and since every
      // eligible cell on the WHOLE sheet shares this SAME hook instance's capture handler, a stuck
      // ref silently blocks normal tap-to-select grid-wide, not just on the one cell that got
      // stuck, until the page is reloaded. Treating anything older than STALE_MS as abandoned (and
      // clearing it right here) means the worst a missed cleanup ever costs is one brief stale
      // window, not the rest of the session.
      if (Date.now() - pending.startedAt > STALE_MS) {
        clearPending();
        return;
      }
      e.nativeEvent.stopImmediatePropagation();
    },
    // A touch sequence that MIGHT become a long-press — nothing is selected yet (see
    // onMouseDownCapture above for why the normal tap-to-select/edit is deliberately deferred, not
    // run immediately here). If held past PRESS_MS without enough movement to cancel, opens the
    // dropdown with whatever onPressComplete resolves to.
    onTouchStart: (e: ReactTouchEvent<HTMLElement>) => {
      const touch = e.touches[0];
      if (!touch) return;
      // Defensively clears out any PREVIOUS pending press this same ref might still be holding
      // onto — belt-and-braces alongside onMouseDownCapture's own staleness check above, since this
      // (a brand new touch starting) is an even more direct signal that whatever was pending before
      // is over, regardless of why its own cleanup never ran.
      clearPending();
      const cellEl = e.currentTarget;
      // iOS's native magnifier loupe (shown for precise caret placement during a hold) triggers
      // directly off the contentEditable element itself, independent of the ANCESTOR cell's own
      // WebkitUserSelect/WebkitTouchCallout suppression (its own style at each call site) — that
      // covers TEXT SELECTION and the copy/look-up CALLOUT MENU, but caret-placement magnification
      // is tied to the editable element's own identity, not inherited selection behavior, so
      // without this too the magnifier (and the keyboard/text-cursor UI underneath it) visually
      // swallowed the whole hold, making the dropdown underneath it read as "nothing happens."
      // Suppressed directly on the real div for the duration of THIS press only (restored by
      // clearPending above/below), so a plain short tap's own normal typing/caret placement is
      // unaffected.
      const editableEl = cellEl.querySelector<HTMLElement>('[contenteditable="true"]');
      if (editableEl) {
        editableEl.style.setProperty("-webkit-user-select", "none");
        editableEl.style.setProperty("-webkit-touch-callout", "none");
      }
      const timer = setTimeout(() => {
        const pending = pressRef.current;
        if (!pending) return;
        pending.fired = true;
        // Belt-and-braces: if the browser went ahead and natively focused this cell's own editable
        // text (contentEditable focuses on tap by default, independent of the React handlers
        // suppressed above) sometime during the hold, un-focus it now rather than letting the hold
        // open an on-screen keyboard behind the popup — a highlighted, NOT an editing, cell is the
        // whole point of this gesture.
        if (document.activeElement instanceof HTMLElement && cellEl.contains(document.activeElement)) {
          document.activeElement.blur();
        }
        const action = onPressComplete();
        if (action) {
          setMenu({
            x: touch.clientX,
            y: touch.clientY,
            label: action.label,
            title: action.title,
            onConfirm: () => {
              action.onClick();
              closeMenu();
            },
          });
        }
      }, PRESS_MS);
      pressRef.current = { row, col, x: touch.clientX, y: touch.clientY, timer, fired: false, editableEl, startedAt: Date.now() };
    },
    // Moving far enough reads as the start of a scroll, not a hold — cancel outright rather than
    // guessing; a short tap's own select still correctly happens on touchend either way (this only
    // ever cancels a press that hasn't fired yet).
    onTouchMove: (e: ReactTouchEvent<HTMLElement>) => {
      const pending = pressRef.current;
      const touch = e.touches[0];
      if (!pending || !touch) return;
      if (Math.abs(touch.clientX - pending.x) > MOVE_CANCEL_PX || Math.abs(touch.clientY - pending.y) > MOVE_CANCEL_PX) {
        clearPending();
      }
    },
    onTouchEnd: (e: ReactTouchEvent<HTMLElement>) => {
      const pending = pressRef.current;
      if (!pending) return;
      const { row: pendingRow, col: pendingCol, fired } = pending;
      clearPending();
      if (!fired) {
        // Finger lifted before the long-press threshold — a short tap, not a hold. Replay the
        // plain single-cell select the suppressed mousedown would have done (the deferred half of
        // this gesture's own deal).
        setSelection({ anchorRow: pendingRow, anchorCol: pendingCol, focusRow: pendingRow, focusCol: pendingCol });
        return;
      }
      // It WAS a hold, the dropdown's already open — stop whatever native tap/click the browser
      // would otherwise still dispatch for this touch sequence now that it's lifted (another guard
      // against it silently focusing the cell's own editable text right as the popup appears).
      e.preventDefault();
    },
    onTouchCancel: () => {
      clearPending();
    },
  });

  return { makeHandlers, menu, menuClosing, menuRef };
}

// The actual dropdown panel for useMobileCellLongPressMenu above — a small anchored menu (same
// visual convention as headerContextMenu/zoneContextMenu elsewhere in this file), not the heavier
// grow-from-origin glass modal treatment, since this is a quick single-action dropdown, not a real
// dialog. Dismissed by tapping/clicking outside it, or by using the action itself (both routed
// through the hook's own closeMenu, so it always plays its pop-away first instead of vanishing).
// color/icon are the only things that vary per caller (Mark for Confirmation's always green;
// Import from Quote's brand blue) — positioning, sizing, and the pop in/out animation are shared.
function MobileLongPressMenu({
  menu,
  menuClosing,
  menuRef,
  color,
  icon,
}: {
  menu: { x: number; y: number; label: string; title: string; onConfirm: () => void } | null;
  menuClosing: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  color: string;
  icon: ReactNode;
}) {
  if (!menu || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={menuRef}
      className={`${menuClosing ? "floating-bar-slot-pop" : "glass-bubble-pop"} fixed z-[2000] w-[240px] overflow-hidden rounded-[10px] border py-1.5`}
      style={{
        // Positioning is baked into plain left/top pixel values (centered above the press point,
        // each edge clamped so it can't run off a narrow phone screen) rather than a CSS transform:
        // both the pop-in (glass-bubble-pop) and pop-away (floating-bar-slot-pop) classes below
        // drive `transform` themselves for their own scale bounce — same conflict, same fix, as
        // FloatingBarSlot's own entrance animation elsewhere in this file (see its comment) — a
        // transform used for positioning here would otherwise get clobbered by theirs for the
        // animation's own duration.
        left: Math.min(Math.max(menu.x, 128), window.innerWidth - 128) - 120,
        top: Math.max(8, menu.y - 64),
        borderColor: "var(--glass-border)",
        backgroundColor: "var(--glass-bg-strong)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        boxShadow: "var(--shadow-glass)",
      }}
    >
      <button
        type="button"
        onClick={menu.onConfirm}
        title={menu.title}
        className="flex w-full items-center gap-2.5 whitespace-nowrap px-4 py-3 text-left text-[14px] font-bold"
        // No hover:brightness-95 (and tap-highlight explicitly killed) — this is a touch-only menu,
        // and a browser's own sticky :hover/tap-flash on a just-tapped element reads as the button
        // staying stuck "lit up" after it appears, not a real hover state. userSelect/
        // WebkitTouchCallout: none for the same reason the cell being held already gets it (see
        // useMobileCellLongPressMenu's own onTouchStart) — this button renders right under where
        // the finger's still resting the instant the hold completes, so without this ITS OWN label
        // text was what ended up visibly highlighted once it appeared.
        style={{
          color,
          WebkitTapHighlightColor: "transparent",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
        }}
      >
        {icon}
        {menu.label}
      </button>
    </div>,
    document.body,
  );
}

function FloatingSideButton({ target }: { target: FloatingSideButtonTarget | null }) {
  const [rendered, setRendered] = useState(target);
  const [poppingGhost, setPoppingGhost] = useState<{
    rect: { left: number; top: number; width: number; height: number };
    content: ReactNode;
  } | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const prevIdRef = useRef<string | null>(target?.id ?? null);

  useEffect(() => {
    const nextId = target?.id ?? null;
    if (nextId === prevIdRef.current) {
      // Same button still targeted (or still nothing targeted) — just let its position/content
      // re-render normally, no pop involved.
      if (target) setRendered(target);
      return;
    }
    prevIdRef.current = nextId;
    if (!rendered) {
      // Nothing currently shown — mount directly; its own glass-bubble-pop entrance (below) handles
      // the appearance.
      setRendered(target);
      return;
    }
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) setPoppingGhost({ rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, content: rendered.content });
    setRendered(target);
    const timeout = window.setTimeout(() => setPoppingGhost(null), 180);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return (
    <>
      {rendered ? (
        <div
          ref={wrapperRef}
          className="glass-bubble-pop absolute z-10 flex items-center gap-1.5"
          style={{
            left: rendered.leftPx,
            top: rendered.topPx,
            // Slides smoothly to a new position while the SAME button stays targeted (e.g. Mark for
            // Confirmation tracking the selection from row to row — it shows on most rows, so this
            // is its common case, not the rarer true appear/disappear). Suppressed (snaps instantly)
            // while a pop is in flight: the id just changed and this div already jumped straight to
            // the NEW target's position in the same tick the ghost above started popping away at the
            // OLD one (see the effect above) — animating this real div's own move at the same time
            // would visibly slide a second copy underneath the popping ghost.
            transition: poppingGhost ? "none" : "top 200ms ease, left 200ms ease",
          }}
        >
          {rendered.content}
        </div>
      ) : null}
      {poppingGhost && typeof document !== "undefined"
        ? createPortal(
            <div
              className="floating-bar-slot-pop pointer-events-none fixed flex items-center gap-1.5"
              style={{
                left: poppingGhost.rect.left,
                top: poppingGhost.rect.top,
                width: poppingGhost.rect.width,
                height: poppingGhost.rect.height,
                zIndex: 2000,
              }}
            >
              {poppingGhost.content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export default function SpecsGridEditor({
  value,
  onChange,
  className,
  showPageSizeSelector,
  companyLogoUrl,
  companyColor,
  showGroupVisibilityPanel,
  toolbarFixedTopPx,
  toolbarFixedRightPx,
  toolbarFixedLeftPx,
  groupsSupportPricing,
  hideSectionsBar,
  allowConfirmationMarking,
  companyRoleOptions,
  productOptions,
  canEditSpecsGroup,
  lockUngroupedBlankCells,
  showEditableGroupBorders,
  hideCellSelectionOutline,
  isSentToClient,
  isViewingSavedVersion,
  fitToViewportOnMobile,
  canvasBottomInsetPx,
  mobileTopOffsetPx,
  highlightedGroupId,
  onHoveredGroupChange,
  linkedQuoteSourceGrid,
  quoteGridForLinkedPull,
  zonePreviewMode,
  onSelectionRangeChange,
  previewZones,
  onZoneContextMenu,
  onSheetZoomedAwayFromEdge,
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
  // zonePreviewMode's own selection-reporting — see onSelectionRangeChange's comment on
  // SpecsGridEditorProps for why the host needs this (its "Mark Selection as Editable Zone" button
  // lives outside this instance entirely, above the preview, not in a context menu inside it).
  useEffect(() => {
    if (!onSelectionRangeChange) return;
    if (!selection) {
      onSelectionRangeChange(null);
      return;
    }
    const rect = normalizeRect(selection);
    onSelectionRangeChange({ minRow: rect.minRow, maxRow: rect.maxRow });
  }, [selection, onSelectionRangeChange]);
  // A separate, non-contiguous selection built via Ctrl/Cmd+click — used ONLY by the "Mark for
  // Confirmation" toolbar button (project view), so staff can mark many scattered cells across the
  // sheet as one bulk action instead of one cell at a time. Deliberately independent of `selection`
  // (the normal single-rectangle selection every other toolbar action reads) rather than extending
  // that model to arbitrary multi-cell ranges, which would ripple into merge/border/fill/copy-paste
  // and every other selection-based action that assumes one contiguous rectangle. Keyed by
  // `${row}:${col}`.
  const [ctrlMarkedCells, setCtrlMarkedCells] = useState<Set<string>>(new Set());
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
  // Right-click near the bottom of the viewport (a real risk in the template builders — this menu can
  // grow tall: row/col actions, the Group button, "Add to Existing Group" listing every other group,
  // Remove Group) would otherwise render mostly or entirely off-screen below the click point. Measured
  // and flipped upward (anchored to the click's Y instead of growing down from it) whenever the menu's
  // OWN rendered height wouldn't fit in the remaining space below. Done via a ref callback (fired by
  // React the instant the portal's div is actually attached to the DOM, i.e. already has real layout
  // to measure) rather than a useEffect+setState pair, so the corrected position is applied within the
  // very same commit the element first mounts in — no visible jump a moment after an unflipped
  // position briefly shows.
  const [headerContextMenuTop, setHeaderContextMenuTop] = useState<number | null>(null);
  const setHeaderContextMenuNode = useCallback(
    (node: HTMLDivElement | null) => {
      headerContextMenuRef.current = node;
      if (!node || !headerContextMenu) return;
      const menuHeight = node.getBoundingClientRect().height;
      const margin = 4;
      const overflowsBottom = headerContextMenu.y + menuHeight > window.innerHeight - margin;
      setHeaderContextMenuTop(overflowsBottom ? Math.max(margin, headerContextMenu.y - menuHeight) : headerContextMenu.y);
    },
    [headerContextMenu],
  );

  useEffect(() => {
    if (!headerContextMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      if (headerContextMenuRef.current?.contains(e.target as Node)) return;
      setHeaderContextMenu(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [headerContextMenu]);

  // Horizontal/vertical alignment are each collapsed into a single toolbar button that shows only
  // whichever option is currently active plus a chevron — clicking it opens a small dropdown of the
  // other two options instead of showing all three as separate always-visible buttons.
  const [alignDropdown, setAlignDropdown] = useState<{ axis: "h" | "v"; anchorRect: { left: number; top: number; width: number; height: number } } | null>(null);
  const alignDropdownRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!alignDropdown) return;
    const onPointerDown = (e: MouseEvent) => {
      if (alignDropdownRef.current?.contains(e.target as Node)) return;
      setAlignDropdown(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [alignDropdown]);

  // The old separate T/R/B/L toggles + border-color swatch + width field are now all reachable from
  // this one popover, opened from the toolbar's single "Border" button. The nested color picker
  // (colorPopover, kind: "border") is a genuinely separate portal — outside-clicks on it must NOT
  // count as "outside" this popover, or picking a color would immediately close the whole thing.
  const [borderPopoverAnchorRect, setBorderPopoverAnchorRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const borderPopoverRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!borderPopoverAnchorRect) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (borderPopoverRef.current?.contains(target)) return;
      if (target.closest('[data-specs-color-popover="true"]')) return;
      setBorderPopoverAnchorRect(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [borderPopoverAnchorRect]);

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
    setLiveGrid(value);
  }, [value]);

  // Undo/redo history — the actual snapshot stacks live in refs (only ever read at click-time, never
  // rendered directly), but React forbids reading a ref's `.current` during render (it can't track
  // that as a render input, so the component wouldn't reliably re-render when it changes) — so a
  // small `historyCounts` STATE mirrors just the two stacks' lengths, updated alongside every push/
  // pop, and canUndo/canRedo below read that instead.
  const undoStackRef = useRef<SpecsGrid[]>([]);
  const redoStackRef = useRef<SpecsGrid[]>([]);
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const MAX_HISTORY_ENTRIES = 100;

  // Every genuine, committed edit (persist === true) pushes the grid as it stood right BEFORE that
  // edit — never the edit itself — so undo always means "go back to what it looked like a moment
  // ago." A fresh edit always clears the redo stack: once you've branched off in a new direction,
  // whatever was "ahead" on the old timeline no longer applies.
  const pushHistory = (beforeGrid: SpecsGrid) => {
    undoStackRef.current.push(beforeGrid);
    if (undoStackRef.current.length > MAX_HISTORY_ENTRIES) undoStackRef.current.shift();
    redoStackRef.current = [];
    setHistoryCounts({ undo: undoStackRef.current.length, redo: 0 });
  };

  // One choke point every structural/content mutation in this component funnels through
  // (insertRow/removeRow/insertColumn/removeColumn, merge/unmerge, cell text commits, image
  // insert/remove, cell style, toggleCellConfirmable, drag-resize commits...) — gating it here
  // once, rather than patching each individual button/handler, is what makes the sheet
  // COMPLETELY locked the moment it's sent (isSentToClient), not just the specific actions
  // (delete row, text edit) already covered piecemeal before this. The only way past this while
  // sent is the parent page's own "Save Version" escape hatch (see its own comment in
  // app/(app)/projects/[projectId]/page.tsx), which resets the sheet and revokes the link
  // BEFORE remounting this component with isSentToClient already false.
  const applyChange = (next: SpecsGrid, persist: boolean) => {
    if (isSentToClient) return;
    if (persist) pushHistory(liveGridRef.current);
    liveGridRef.current = next;
    setLiveGrid(next);
    if (persist) onChange(next);
  };

  const undo = () => {
    if (isSentToClient) return;
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(liveGridRef.current);
    liveGridRef.current = prev;
    setLiveGrid(prev);
    onChange(prev);
    setHistoryCounts({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
  };

  const redo = () => {
    if (isSentToClient) return;
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(liveGridRef.current);
    liveGridRef.current = next;
    setLiveGrid(next);
    onChange(next);
    setHistoryCounts({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
  };
  const canUndo = historyCounts.undo > 0;
  const canRedo = historyCounts.redo > 0;

  const activeCell = (() => {
    if (!selection) return null;
    const rect = normalizeRect(selection);
    return { row: rect.minRow, col: rect.minCol, cell: liveGrid.rows[rect.minRow]?.cells[rect.minCol] ?? null };
  })();

  const currentAlign = activeCell?.cell?.style?.align ?? (activeCell?.cell?.imageUrl ? "center" : "left");
  const currentValign = activeCell?.cell?.style?.verticalAlign ?? (activeCell?.cell?.imageUrl ? "middle" : "top");

  const canMerge = selection ? canMergeSelection(liveGrid, selection) : false;
  const canUnmerge = activeCell?.cell ? (() => {
    const { rowSpan, colSpan } = getCellSpan(activeCell.cell);
    return rowSpan > 1 || colSpan > 1;
  })() : false;

  // Commits a cell's rich text directly — used both on blur (a plain edit) and immediately after an
  // in-cell Ctrl+B/Ctrl+U or toolbar click applies a partial-selection format (which doesn't blur the
  // cell, so there's no other moment this would otherwise get saved).
  const commitCellRuns = (row: number, col: number, runs: SpecsTextRun[]) => {
    const cell = liveGrid.rows[row]?.cells[col];
    if (!cell) return;
    const normalized = normalizeTextRuns(runs);
    const text = runsToPlainText(normalized);
    const rows = liveGrid.rows.map((r, ri) => {
      if (ri !== row) return r;
      const cells = r.cells.map((c, ci) => (ci === col ? { ...c!, text, runs: normalized } : c));
      return { ...r, cells };
    });
    applyChange({ pageSize: liveGrid.pageSize, columnWidths: liveGrid.columnWidths, groups: liveGrid.groups, deletedGroups: liveGrid.deletedGroups, rows }, true);
  };

  // Whole-cell bold/underline toggle for exactly one cell — used when Ctrl+B/Ctrl+U fires with
  // nothing highlighted (the "entire cell controls all of the text within it" case), targeting the
  // cell being typed in directly rather than going through the grid's own `selection` state.
  const toggleCellRunsAt = (row: number, col: number, key: "bold" | "underline") => {
    const cell = liveGrid.rows[row]?.cells[col];
    if (!cell) return;
    const currentRuns = getCellRuns(cell);
    const allOn = currentRuns.every((r) => Boolean(r[key]));
    commitCellRuns(row, col, currentRuns.map((r) => ({ ...r, [key]: !allOn })));
  };

  // Toolbar Bold/Underline: if the cell currently focused for editing has real highlighted text,
  // format just that (native execCommand, committed immediately since no blur will fire); otherwise
  // fall back to the existing grid-selection-based whole-cell(s) toggle.
  const applyFormatCommand = (key: "bold" | "underline") => {
    const active = document.activeElement;
    if (focusedKey && active instanceof HTMLElement && active.isContentEditable && applyFormatCommandToSelection(active, key)) {
      const [row, col] = focusedKey.split(":").map(Number);
      commitCellRuns(row, col, parseHtmlToRuns(active.innerHTML));
      return;
    }
    if (!selection || isSelectionLocked(selection)) return;
    applyChange(mapSelectedCellsRunFormat(liveGrid, selection, key), true);
  };

  // Grows a row (or, for a merged cell, the LAST row in its span — see below) to fit a cell's own
  // natural content height whenever it needs more room than currently available. Never shrinks a row
  // back down on its own — only ever grows, same one-directional convention already used elsewhere in
  // this editor (a row also never auto-shrinks just because text was deleted).
  //
  // A merged (rowSpan > 1) cell's rendered height is the SUM of every row it spans — there's no single
  // one of them that's obviously "the" row to grow, so the extra all goes onto the LAST row in the
  // span, leaving whatever's ABOVE it (e.g. a deliberately short header row merged together with a
  // taller content row) at its own configured height. For a plain single-row cell this is the exact
  // same math as before — rowSpan 1 just means "sum of one row", i.e. that row's own height.
  //
  // Persistence: while the cell being grown is the one CURRENTLY FOCUSED (actively being typed into),
  // this only updates `liveGrid` locally (no undo entry, no onChange/persist yet — same "cheap
  // local-only preview, commit later" pattern already used for column/row drag-resize) — the actual
  // persisted commit happens separately, on blur (commitCellRuns → applyChange), which naturally
  // carries whatever height this already grew `liveGrid` to, since it preserves the row's existing
  // heightPx via its own `{ ...r, cells }` spread. But a NON-interactive content change — e.g.
  // "Import from Quote" calling applyChange directly, with nothing focused — has no later blur to
  // rely on, so for that case this persists the grown height immediately via `onChange` directly
  // (not a second applyChange call, deliberately: Ctrl+Z on the import should undo the text AND its
  // own height growth together as one action, not need a second undo for the height alone).
  const growRowForCellHeight = (row: number, col: number, cell: SpecsCell | null, naturalHeightPx: number) => {
    const { rowSpan } = getCellSpan(cell);
    const rows = liveGridRef.current.rows;
    const lastRow = row + Math.max(1, rowSpan) - 1;
    const readHeightPx = (ri: number): number => {
      const h = rows[ri]?.heightPx;
      return typeof h === "number" && Number.isFinite(h) && h > 0 ? h : DEFAULT_ROW_HEIGHT_PX;
    };
    let currentHeight = 0;
    for (let r = row; r <= lastRow; r += 1) currentHeight += readHeightPx(r);
    // A few px of slack absorbs ordinary browser measurement noise (sub-pixel layout rounding,
    // slightly different rendering while focused vs. not) — without it, merely clicking into a cell
    // (which re-measures the PREVIOUSLY-focused cell as it loses focus) could nudge a row a pixel or
    // two taller on every first click, even though nothing about its content actually needed more
    // room. A genuinely wrapped extra line is a much bigger jump than this (a full line height, easily
    // 14px+), so real wrapping still grows the row correctly.
    if (naturalHeightPx <= currentHeight + GROW_ROW_TOLERANCE_PX) return;
    const extra = naturalHeightPx - currentHeight;
    const nextRows = rows.map((r, ri) => (ri === lastRow ? { ...r, heightPx: Math.ceil(readHeightPx(lastRow) + extra) } : r));
    const next: SpecsGrid = {
      pageSize: liveGridRef.current.pageSize,
      columnWidths: liveGridRef.current.columnWidths,
      groups: liveGridRef.current.groups,
      deletedGroups: liveGridRef.current.deletedGroups,
      rows: nextRows,
    };
    liveGridRef.current = next;
    setLiveGrid(next);
    if (focusedKey !== `${row}:${col}`) onChange(next);
  };

  // True when ANY row touched by `sel` belongs to a group the current viewer isn't allowed to edit
  // (see SpecsGridEditorProps.canEditSpecsGroup), OR falls outside a zone on a group that HAS zones
  // defined (see SpecsRowGroup.zones) — guards the toolbar's own style/format toggles the same way
  // SpecsCellTextArea's own readOnly rendering guards direct typing, so "read-only" isn't just typing
  // being blocked while formatting still goes through. The zone check is isProjectSheetView-gated —
  // it only applies in a live project's actual Quote/Specifications window, never in the Company
  // Settings template builder, where the whole group stays freely editable even though zones are
  // still defined/linked there (via the Group Preview).
  const isSelectionLocked = (sel: SpecsGridSelection): boolean => {
    const rect = normalizeRect(sel);
    for (let r = rect.minRow; r <= rect.maxRow; r += 1) {
      const g = findRowGroupForRow(expandedGroups, r);
      if (canEditSpecsGroup && g?.editableByRoleIds && g.editableByRoleIds.length > 0 && !canEditSpecsGroup(g)) return true;
      if (isProjectSheetView && g?.zones?.length && !isRowWithinGroupZone(g, r)) return true;
    }
    return false;
  };

  const toggleStyle = (mutate: (style: SpecsCellStyle) => SpecsCellStyle) => {
    if (!selection || isSelectionLocked(selection)) return;
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
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  useEffect(() => {
    copySelectionRef.current = copySelection;
    pasteAtSelectionRef.current = pasteAtSelection;
    undoRef.current = undo;
    redoRef.current = redo;
  });

  // Ctrl/Cmd+C / Ctrl/Cmd+V / Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z (or +Y) at the grid level — skipped while
  // actually editing a cell's text (its own contentEditable is focused) so normal in-cell text
  // copy/paste/undo keeps working untouched. Mounted exactly once: re-subscribing this on every
  // render (it previously had no dependency array) meant tearing down and re-attaching a window
  // listener on every render — including every tick of a drag-select or drag-resize, both of which
  // already re-render frequently — which was visible as stutter/"glitching" while editing.
  useEffect(() => {
    // zonePreviewMode: this instance is a throwaway, read-only, nested preview — it has nothing of
    // its own to undo/copy/paste, and since this listener isn't scoped to its own DOM subtree (it's
    // attached to `window`), leaving it mounted here would ALSO fire on keystrokes meant for the
    // outer sheet this preview is nested inside (see zonePreviewMode's own comment on
    // SpecsGridEditorProps).
    if (zonePreviewMode) return;
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
      } else if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redoRef.current();
        else undoRef.current();
      } else if (key === "y") {
        e.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // zonePreviewMode is a one-time mount flag for this instance (never toggles later in practice —
    // see its own comment on SpecsGridEditorProps), so intentionally left out here the same way this
    // effect was already deliberately dependency-free before zonePreviewMode existed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Shared bulk setter for either of SpecsCell's two confirmation-related boolean fields — applies
  // the same add/remove logic across every cell in `targets` as ONE undo step. Every targeted cell
  // ends up in the SAME `value` (a plain "select all / deselect all" convention) rather than each
  // cell independently toggling its own current state, which would be ambiguous for a mixed
  // selection. Turning OFF "confirmable" (the LIVE project's own active-question flag) also clears
  // any prior answer — a cell that's no longer this round's question shouldn't keep showing a stale
  // Yes/No. "confirmableAllowed" (the TEMPLATE BUILDER's own eligibility flag — see its own comment
  // on SpecsCell) has no such side effect; turning it off just removes the one field.
  const setCellsConfirmField = (targets: { row: number; col: number }[], field: "confirmable" | "confirmableAllowed", value: boolean) => {
    const targetSet = new Set(targets.map((t) => `${t.row}:${t.col}`));
    const rows = liveGrid.rows.map((r, ri) => {
      const cells = r.cells.map((c, ci) => {
        if (!c || !targetSet.has(`${ri}:${ci}`)) return c;
        if (value) return { ...c, [field]: true };
        if (field === "confirmable") {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { confirmable: _removedConfirmable, confirmedYes: _removedYes, confirmedAt: _removedAt, ...rest } = c;
          return rest;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { confirmableAllowed: _removedAllowed, ...rest } = c;
        return rest;
      });
      return { ...r, cells };
    });
    applyChange({ pageSize: liveGrid.pageSize, columnWidths: liveGrid.columnWidths, groups: liveGrid.groups, deletedGroups: liveGrid.deletedGroups, rows }, true);
  };
  const setCellsConfirmable = (targets: { row: number; col: number }[], nextConfirmable: boolean) =>
    setCellsConfirmField(targets, "confirmable", nextConfirmable);
  const setCellsConfirmableAllowed = (targets: { row: number; col: number }[], nextAllowed: boolean) =>
    setCellsConfirmField(targets, "confirmableAllowed", nextAllowed);
  const toggleCellConfirmable = (row: number, col: number) => {
    const cell = liveGrid.rows[row]?.cells[col];
    if (!cell) return;
    setCellsConfirmable([{ row, col }], !cell.confirmable);
  };
  const toggleCellConfirmableAllowed = (row: number, col: number) => {
    const cell = liveGrid.rows[row]?.cells[col];
    if (!cell) return;
    setCellsConfirmableAllowed([{ row, col }], !cell.confirmableAllowed);
  };
  // Shared by the desktop floating "Mark for Confirmation" button AND mobile's own long-press
  // version of it (the data cell's onTouchStart handlers, further down) — computes which cell(s)
  // the action would currently act on and returns everything a caller needs to show it (label/
  // title/onClick), or null when nothing confirmableAllowed is currently selected/pressed. Only
  // ever targets cells the TEMPLATE marked confirmableAllowed (see that field's own comment on
  // SpecsCell) — silently dropping any other cell out of whatever's currently selected, rather than
  // letting staff turn an arbitrary cell into a question the template author never set up for that.
  // Ctrl/Cmd+click multi-select (ctrlMarkedCells) takes precedence over a drag-highlighted range
  // whenever it's non-empty; a single remaining eligible cell (whichever way it got there) toggles
  // directly instead of going through the bulk "mark/unmark all" path.
  const computeMarkForConfirmationTarget = (
    // Mobile's long-press only, see its own call site: the just-pressed cell to fall back to when
    // nothing's already selected. Needed because the long-press handler calls setSelection(...) to
    // highlight that cell THEN calls this in the same synchronous tick — React state updates aren't
    // visible to a closure that way, so `selection` here would still read whatever it was BEFORE
    // that call, not the cell just pressed. Passing it straight through sidesteps that entirely
    // rather than relying on timing.
    fallbackCell?: { row: number; col: number },
    // Mobile's long-press only, same reasoning as fallbackCell but for the OTHER half of the same
    // staleness problem: if the pressed cell DOESN'T already sit inside a bigger pre-existing
    // selection, the caller also calls setSelection(...) to replace whatever was selected before —
    // but `selection`/`ctrlMarkedCells` below would still read that OLD, about-to-be-replaced value
    // in this same synchronous tick, silently acting on whatever used to be highlighted instead of
    // the cell actually just pressed. True tells this to skip reading selection/ctrlMarkedCells
    // entirely and use ONLY fallbackCell — safe exactly when the caller already knows (from its own,
    // up-to-the-moment check) that fallbackCell IS the whole, correct target, not just a backstop
    // for "nothing selected at all".
    forceFallbackCellOnly?: boolean,
  ): {
    allTargets: { row: number; col: number }[];
    isMultiple: boolean;
    isActive: boolean;
    label: string;
    title: string;
    onClick: () => void;
  } | null => {
    const isCellAllowed = (r: number, c: number) => Boolean(liveGrid.rows[r]?.cells[c]?.confirmableAllowed);
    let allTargets: { row: number; col: number }[];
    let usingCtrlMarked = false;
    if (forceFallbackCellOnly) {
      allTargets = fallbackCell && isCellAllowed(fallbackCell.row, fallbackCell.col) ? [fallbackCell] : [];
    } else {
      const ctrlMarkedTargets = Array.from(ctrlMarkedCells)
        .map((k) => {
          const [r, c] = k.split(":").map(Number);
          return { row: r, col: c };
        })
        .filter((t) => isCellAllowed(t.row, t.col));
      // Every real (non-null), confirmableAllowed cell inside the current drag-highlighted
      // rectangle — NOT just its top-left slot, which is all `activeCell` itself ever points at
      // (see its own comment: it's always rect.minRow/minCol).
      const dragRangeTargets = (() => {
        if (!selection) return [];
        const rect = normalizeRect(selection);
        const out: { row: number; col: number }[] = [];
        for (let r = rect.minRow; r <= rect.maxRow; r += 1) {
          for (let c = rect.minCol; c <= rect.maxCol; c += 1) {
            if (isCellAllowed(r, c)) out.push({ row: r, col: c });
          }
        }
        return out;
      })();
      // Whenever a Ctrl/Cmd+click multi-select is active at all, it's the one source of truth for
      // the target list — even if every cell in it turns out ineligible (returns null below),
      // rather than silently falling back to an unrelated drag-highlighted range the user didn't
      // actually pick via this gesture.
      usingCtrlMarked = ctrlMarkedCells.size > 0;
      allTargets = usingCtrlMarked ? ctrlMarkedTargets : dragRangeTargets;
      if (allTargets.length === 0 && fallbackCell && isCellAllowed(fallbackCell.row, fallbackCell.col)) {
        allTargets = [fallbackCell];
      }
    }
    if (allTargets.length === 0) return null;

    const isMultiple = allTargets.length > 1;
    const isActive = !isMultiple && Boolean(liveGrid.rows[allTargets[0].row]?.cells[allTargets[0].col]?.confirmable);
    const label = isMultiple ? `Mark ${allTargets.length} Cells` : isActive ? "Confirmable ✓" : "Mark for Confirmation";
    const title = isMultiple
      ? `Mark or unmark all ${allTargets.length} selected cells for client confirmation`
      : "Mark this cell for the client to confirm with Yes/No — Ctrl/Cmd+click other cells to select several at once";
    const onClick = () => {
      if (isMultiple) {
        const allAlreadyConfirmable = allTargets.every((t) => Boolean(liveGrid.rows[t.row]?.cells[t.col]?.confirmable));
        setCellsConfirmable(allTargets, !allAlreadyConfirmable);
      } else {
        toggleCellConfirmable(allTargets[0].row, allTargets[0].col);
      }
      // Cleared after acting on it either way — a plain "select all / deselect all" gesture that
      // shouldn't linger and get reused unintentionally by a later, unrelated click.
      if (usingCtrlMarked) setCtrlMarkedCells(new Set());
    };
    return { allTargets, isMultiple, isActive, label, title, onClick };
  };
  // Mobile long-press dropdowns for "Mark for Confirmation" and "Import from Quote" — see
  // useMobileCellLongPressMenu's own comment for the shared gesture mechanics. Two SEPARATE
  // instances (not one shared between both actions): each has its own independent in-progress-press
  // bookkeeping and its own open/closed dropdown, since a cell could in principle be eligible for
  // either one somewhat independently of the other (see isMobileImportEligible/
  // isMobileConfirmEligible below), and conflating them would mean one feature's open dropdown
  // could get silently stolen/closed by the other's own gesture tracking.
  const mobileConfirmLongPress = useMobileCellLongPressMenu(setSelection);
  const mobileImportLongPress = useMobileCellLongPressMenu(setSelection);

  // Mobile-only drag handles on the current selection's own 4 edges (its render is further down,
  // next to selectionOutline) — a touch device has no equivalent of a mouse drag across cells to
  // extend a selection (onMouseEnter below only ever fires for the element a touch STARTED on, not
  // whatever's currently under a moving finger, and treating any touch-drag across the sheet as a
  // selection-drag would fight the pinch/pan gesture already living on the same surface). A small
  // dedicated handle per edge sidesteps that entirely: each one is its own deliberate touch target,
  // only ever changing the ONE edge it sits on (top/bottom move the row range, left/right the column
  // range), so there's never a question of what a stray touch-drag elsewhere on the sheet means.
  // Tracked as a ref, not state — this is live per-frame drag bookkeeping, not something that should
  // schedule its own re-render on every touchmove (only `selection` itself, already state, needs to
  // re-render as it's dragged).
  const selectionHandleDragRef = useRef<{ edge: "top" | "bottom" | "left" | "right"; startRect: CellRect } | null>(null);
  // Which edge (if any) is actively being dragged — state, not the ref above, purely so the handle
  // being touched can grow slightly as feedback; reposition-while-dragging itself is driven by
  // `selection` already re-rendering on every touchmove, not by this.
  const [draggingSelectionHandle, setDraggingSelectionHandle] = useState<"top" | "bottom" | "left" | "right" | null>(null);
  // Resolves a touch point to the real data cell currently under it (NOT the element the touch
  // GESTURE started on — these handles sit outside every cell, and the finger is meant to move
  // across other cells entirely) via document.elementFromPoint, which — unlike doing this math by
  // hand — already accounts for the sheet's own current pinch-zoom scale/pan transform for free: it
  // answers "what's actually rendered at this screen pixel," which is exactly what's needed
  // regardless of how zoomed in/panned the mobile preview currently is.
  const resolveTouchToCell = (clientX: number, clientY: number): { row: number; col: number } | null => {
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-row][data-col]");
    if (!el) return null;
    const row = Number(el.dataset.row);
    const col = Number(el.dataset.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
    return { row, col };
  };
  const onSelectionHandleTouchStart = (edge: "top" | "bottom" | "left" | "right") => (e: ReactTouchEvent<HTMLDivElement>) => {
    if (!selection) return;
    e.stopPropagation();
    selectionHandleDragRef.current = { edge, startRect: normalizeRect(selection) };
    setDraggingSelectionHandle(edge);
  };
  const onSelectionHandleTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    const drag = selectionHandleDragRef.current;
    const touch = e.touches[0];
    if (!drag || !touch) return;
    e.preventDefault();
    const cell = resolveTouchToCell(touch.clientX, touch.clientY);
    if (!cell) return;
    const { startRect } = drag;
    let { minRow, maxRow, minCol, maxCol } = startRect;
    const lastRow = liveGrid.rows.length - 1;
    const lastCol = liveGrid.columnWidths.length - 1;
    if (drag.edge === "top") {
      minRow = Math.max(0, Math.min(cell.row, startRect.maxRow));
    } else if (drag.edge === "bottom") {
      maxRow = Math.min(lastRow, Math.max(cell.row, startRect.minRow));
    } else if (drag.edge === "left") {
      minCol = Math.max(0, Math.min(cell.col, startRect.maxCol));
    } else {
      maxCol = Math.min(lastCol, Math.max(cell.col, startRect.minCol));
    }
    setSelection({ anchorRow: minRow, anchorCol: minCol, focusRow: maxRow, focusCol: maxCol });
  };
  const onSelectionHandleTouchEnd = () => {
    selectionHandleDragRef.current = null;
    setDraggingSelectionHandle(null);
  };

  // The group-editor modal — a single controlled form (Name/Default/Anchor/roles/Cost all at once)
  // replacing the old inline "Link Rows as Group"/"Rename Group" popover, which built its result up
  // field-by-field from several separately-defaulted uncontrolled inputs. That design was the actual
  // source of "I tick a box and it doesn't stay ticked": re-opening the popover for a group that was
  // already open a moment earlier (right-clicking a second target without the menu ever fully
  // closing/remounting in between) could leave a checkbox showing an uncontrolled <input>'s leftover
  // DOM state from whatever was last open, not this group's own real data — a controlled draft reset
  // fresh every time this modal opens for a specific target can't drift out of sync that way.
  // `groupId: null` means creating a brand-new group from `startRow`/`endRow` (the selection's row
  // span at the moment "Group" was clicked); a real id means editing that existing group in place.
  const [groupModalTarget, setGroupModalTarget] = useState<{ groupId: string | null; startRow: number; endRow: number } | null>(null);
  const [groupModalOrigin, setGroupModalOrigin] = useState<GlassModalOrigin>(null);
  const groupModalPanelRef = useRef<HTMLDivElement | null>(null);
  const groupModalOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderGroupModal = useGlassModalPopOrigin(Boolean(groupModalTarget), groupModalOrigin, groupModalPanelRef, undefined, groupModalOriginElRef);
  const [groupDraft, setGroupDraft] = useState<SpecsRowGroupEditableFields>({
    name: "",
    price: "",
    defaultIncluded: true,
    anchorFirstPageBottom: false,
    editableByRoleIds: [],
    category: "",
    rules: [],
    zones: [],
  });
  // Index being dragged within the zone-link popup's own "currently linked" list (see
  // zoneContextMenu below) — a plain native HTML5 drag-and-drop reorder, deliberately NOT the
  // sheet's own coordinate-based group-row dragging (onSheetDragOver/onSheetDrop further down) which
  // exists to drag a block of REAL rows around the actual sheet; this just swaps two entries in one
  // zone's small linkedQuoteGroups array.
  const [draggingZoneLinkIndex, setDraggingZoneLinkIndex] = useState<number | null>(null);
  // The CURRENT selection's row range inside the Group Preview below (null once nothing's
  // selected there) — reported live by that nested zonePreviewMode instance via
  // onSelectionRangeChange, since its own internal `selection` state is otherwise private to it.
  // Drives the "Mark Selection as Editable Zone" button rendered above the preview.
  const [previewSelectedRowRange, setPreviewSelectedRowRange] = useState<{ minRow: number; maxRow: number } | null>(null);
  // Right-clicking an editable zone in the preview opens this — a small, custom menu (deliberately
  // NOT the sheet's own row-header "Group" menu, which makes no sense for a throwaway crop with no
  // real SpecsRowGroup entries): "view: menu" shows one "Link to Quote Groups" action; clicking it
  // switches to "view: picker", a list of linkable Quote groups (each with an expand arrow revealing
  // that group's OWN editable zone as a sub-choice) plus whatever's already linked. x/y position it
  // at the right-click's own screen coordinates, same as headerContextMenu already does.
  const [zoneContextMenu, setZoneContextMenu] = useState<{ zoneId: string; x: number; y: number; view: "menu" | "picker" } | null>(null);
  // Which quote group ROWS are currently expanded in the picker to reveal their own editable zone as
  // a selectable sub-item — keyed by quote group name, reset whenever the picker itself closes.
  const [expandedQuoteGroupNamesInPicker, setExpandedQuoteGroupNamesInPicker] = useState<Set<string>>(new Set());
  const openGroupModal = (groupId: string | null, startRow: number, endRow: number, existingGroup: SpecsRowGroup | undefined) => {
    setGroupDraft({
      name: existingGroup?.name ?? "",
      price: existingGroup?.price ?? "",
      // "Default it to on" for a brand-new group (existingGroup undefined) — an existing group keeps
      // whatever it already had, including a deliberate off.
      defaultIncluded: existingGroup ? Boolean(existingGroup.defaultIncluded) : true,
      anchorFirstPageBottom: Boolean(existingGroup?.anchorFirstPageBottom),
      editableByRoleIds: existingGroup?.editableByRoleIds ?? [],
      category: existingGroup?.category ?? "",
      rules: existingGroup?.rules ?? [],
      zones: existingGroup?.zones ?? [],
    });
    setPreviewSelectedRowRange(null);
    setZoneContextMenu(null);
    setExpandedQuoteGroupNamesInPicker(new Set());
    setGroupModalTarget({ groupId, startRow, endRow });
  };
  const saveGroupModal = () => {
    if (!groupModalTarget) return;
    const trimmedName = groupDraft.name.trim();
    if (!trimmedName) return;
    const fields: SpecsRowGroupEditableFields = { ...groupDraft, name: trimmedName, category: groupDraft.category.trim() };
    if (groupModalTarget.groupId) {
      applyChange(renameRowGroup(liveGrid, groupModalTarget.groupId, fields), true);
    } else {
      applyChange(createRowGroup(liveGrid, groupModalTarget.startRow, groupModalTarget.endRow, fields), true);
    }
    setGroupModalTarget(null);
  };
  // Recomputed every render off groupDraft/linkedQuoteSourceGrid — this is a settings-modal list,
  // not a hot path, so a plain const (no memo) is simplest and matches how the modal's other
  // derived-for-render values (productOptions, companyRoleOptions, etc.) are already just used
  // directly rather than memoized.
  const linkableQuoteGroups = linkedQuoteSourceGrid ? getExpandedRowGroups(linkedQuoteSourceGrid) : [];
  // The zone currently open in the link picker, if any — looked up fresh every render (not cached in
  // zoneContextMenu itself) so the picker always reflects groupDraft's own latest edits.
  const zoneContextMenuZone = zoneContextMenu ? groupDraft.zones.find((z) => z.id === zoneContextMenu.zoneId) : undefined;
  const zoneContextMenuLinkedRefs = zoneContextMenuZone?.linkedQuoteGroups ?? [];
  const isRefLinked = (quoteGroupName: string, source: "group" | "zone") =>
    zoneContextMenuLinkedRefs.some((r) => r.quoteGroupName === quoteGroupName && r.source === source);
  const toggleZoneLinkRef = (quoteGroupName: string, source: "group" | "zone") => {
    if (!zoneContextMenu) return;
    setGroupDraft((d) => ({
      ...d,
      zones: d.zones.map((z) => {
        if (z.id !== zoneContextMenu.zoneId) return z;
        const existing = z.linkedQuoteGroups ?? [];
        const already = existing.some((r) => r.quoteGroupName === quoteGroupName && r.source === source);
        return {
          ...z,
          linkedQuoteGroups: already
            ? existing.filter((r) => !(r.quoteGroupName === quoteGroupName && r.source === source))
            : [...existing, { quoteGroupName, source }],
        };
      }),
    }));
  };
  // The Group Settings modal's own embedded "Group Preview" (for marking zones) — a throwaway,
  // read-only, cropped SpecsGrid built from the REAL group's own current rows. Only buildable once
  // the group actually exists (groupModalTarget.groupId set): a brand-new group has no committed row
  // range yet to crop. Rebuilt fresh every render off `liveGrid` itself (not a snapshot taken once
  // when the modal opened), so it always reflects the group's current content even if it changed
  // (e.g. a prior "Import from Quote") while this modal happens to be open.
  const previewSourceGroup = groupModalTarget?.groupId
    ? getExpandedRowGroups(liveGrid).find((g) => g.id === groupModalTarget.groupId)
    : null;
  const previewGrid: SpecsGrid | null = previewSourceGroup
    ? {
        pageSize: liveGrid.pageSize,
        columnWidths: liveGrid.columnWidths,
        rows: liveGrid.rows.slice(previewSourceGroup.startRow, previewSourceGroup.endRow + 1),
        groups: [],
      }
    : null;
  // "Import from Quote" — rendered as a small button directly on the sheet next to any group whose
  // "editable" zone has linkedQuoteGroups set (see the expandedGroups render further down), not
  // inside this modal: the link itself is configured ONCE, in the Company Settings
  // template builder, and is read-only once cloned into a project — only the IMPORT (writing the
  // linked Quote groups' current text into the zone) happens per-project, since quotes get
  // customized per client. Feedback is the button itself flashing green with an "Imported" label for
  // a few seconds (see recentlyImportedGroupIds below), not a separate tooltip/status pill — simpler,
  // and it can't be missed since it's right where the user just clicked.
  const [recentlyImportedGroupIds, setRecentlyImportedGroupIds] = useState<Record<string, boolean>>({});
  const pullStatusTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // What was actually written into each group's zone by the most recent import THIS SESSION — "" (or
  // absent) for a group never imported into yet. Compared against the zone's own CURRENT text (see
  // requestImportLinkedQuoteTextIntoZoneForGroup below) to tell "unedited since the last import, a
  // plain refresh" apart from "hand-edited since — importing again would silently throw that away,"
  // confirming only in the second case. Session-only (not persisted onto the grid itself) is fine
  // here — reloading the page simply makes the very next import ask once more, same as if it were
  // never imported at all, which is the safe default anyway.
  const [lastImportedTextByGroupId, setLastImportedTextByGroupId] = useState<Record<string, string>>({});
  // Set while the confirm popup below ("Replace zone content?") is open for a group whose zone text
  // doesn't match what was last imported into it.
  const [pendingImportGroupId, setPendingImportGroupId] = useState<string | null>(null);
  const importLinkedQuoteTextIntoZoneForGroup = (groupId: string) => {
    if (!quoteGridForLinkedPull) return;
    const { grid: pulled, pulledCount, importedText } = importLinkedQuoteTextIntoZone(liveGrid, quoteGridForLinkedPull, groupId);
    applyChange(pulled, true);
    if (pulledCount === 0) return;
    setLastImportedTextByGroupId((prev) => ({ ...prev, [groupId]: importedText }));
    setRecentlyImportedGroupIds((prev) => ({ ...prev, [groupId]: true }));
    if (pullStatusTimeoutsRef.current[groupId]) clearTimeout(pullStatusTimeoutsRef.current[groupId]);
    pullStatusTimeoutsRef.current[groupId] = setTimeout(() => {
      setRecentlyImportedGroupIds((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== groupId)));
      delete pullStatusTimeoutsRef.current[groupId];
    }, 2500);
  };
  // What the on-sheet button actually calls — importLinkedQuoteTextIntoZoneForGroup above only ever
  // runs once this either finds nothing at risk, or the user's confirmed the popup. A zone that's
  // still empty, or whose current text exactly matches what was last imported into it (a plain
  // refresh — nothing of the user's own would be lost), goes straight through with no popup.
  const requestImportLinkedQuoteTextIntoZoneForGroup = (groupId: string) => {
    const currentZoneText = getEditableZoneText(liveGrid, groupId);
    const lastImportedText = lastImportedTextByGroupId[groupId] ?? "";
    if (currentZoneText && currentZoneText !== lastImportedText) {
      setPendingImportGroupId(groupId);
      return;
    }
    importLinkedQuoteTextIntoZoneForGroup(groupId);
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
    // Captured once, at the moment the drag starts, so the undo entry pushed on release is "what it
    // looked like before this whole drag" — not a step partway through it.
    const beforeGrid = liveGrid;
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
      if (liveGridRef.current !== beforeGrid) pushHistory(beforeGrid);
      onChange(liveGridRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onRowResizeStart = (index: number, clientY: number) => {
    isDraggingRef.current = true;
    const beforeGrid = liveGrid;
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
      if (liveGridRef.current !== beforeGrid) pushHistory(beforeGrid);
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
  // Cosmetic-only union with zonePreviewMode (the Group Settings modal's own embedded crop) — this
  // and isProjectSheetView agree on everything PURELY about chrome/layout (row/col headers, resize
  // handles below), but deliberately NOT on real behavioral differences (hidden-row collapsing, the
  // Sections bar, anchorFirstPageBottom, drag/drop, confirmation-marking UI), which stay keyed off
  // isProjectSheetView alone — zonePreviewMode never touches those.
  const isCompactPreview = isProjectSheetView || zonePreviewMode;
  // Project view reserves NO table width for a row header at all — the hover "+ add row"/"- remove
  // row" buttons live in a floating overlay outside the table instead (see the render body), so data
  // columns start flush at x=0 and line up with the mock page's own edge.
  const rowHeaderWidthPx = isCompactPreview ? 0 : ROW_HEADER_WIDTH_PX;
  const colHeaderHeightPx = isCompactPreview ? 0 : COL_HEADER_HEIGHT_PX;

  // Computed once per render and reused everywhere a group's bounds matter (outline, per-row
  // hide-check, the row header context menu's "already grouped?" check) — see getExpandedRowGroups'
  // own comment for why raw `liveGrid.groups` bounds can't be trusted directly. Only a project's own
  // copy (isProjectSheetView) actually collapses hidden rows to zero height — the company
  // template builder always shows every row so groups stay editable.
  const expandedGroups = getExpandedRowGroups(liveGrid);
  // Mobile's own long-press-to-import entry point (see isMobileImportEligible/mobileImportLongPress
  // further down) needs "is THIS row inside some linked editable zone" as a per-cell check, unlike
  // the desktop floating button's own target computation, which tests against the current
  // SELECTION's whole row range instead (see that button's own render further down) — both end up
  // finding the same zone, this is just the single-row-at-a-time version of that same lookup.
  const findImportTargetForRow = (row: number): { groupId: string; groupName: string } | null => {
    for (const g of expandedGroups) {
      const zone = g.zones?.find((z) => z.kind === "editable" && (z.linkedQuoteGroups?.length ?? 0) > 0);
      if (!zone) continue;
      const topRow = g.startRow + zone.startRow;
      const bottomRow = g.startRow + zone.endRow;
      if (row >= topRow && row <= bottomRow) return { groupId: g.id, groupName: g.name };
    }
    return null;
  };
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

  // Computed here (earlier than the rest of the "mock page" sizing below) purely so the
  // anchor-to-bottom shift right after this can use them — everything else about the mock page's
  // sizing stays where it was.
  const mockPageHeightPx = Math.round(SPECS_PAGE_SIZES[liveGrid.pageSize].heightMm * MM_TO_PX);
  // A project's own copy insets its content by the real print margin on every side (so the sheet
  // reads centered on the mock page, matching where it'll actually sit once printed) — the builder
  // keeps its own row/column header gutters instead, unchanged. Applied via a single wrapping div
  // around the table + all its overlays (see the render body) rather than folded into
  // rowHeaderWidthPx/colHeaderHeightPx, so it insets the table's OWN position too, not just where the
  // overlays draw relative to it — and it deliberately does NOT touch the table's own `width` (still
  // just the columns' real total), otherwise the last column would stretch to fill the inset.
  const mockPageMarginPx = isProjectSheetView ? Math.round(SPECS_PAGE_MARGIN_MM * MM_TO_PX) : 0;

  // anchorFirstPageBottom (see its own comment on SpecsRowGroup) — the live on-screen analogue of
  // buildSpecsGridPdfBlob's own print-time version of this calc: if everything before the earliest
  // anchored group, plus that group and everything after it, together still fit within one physical
  // page's usable height, every row from that group onward is pushed down to land flush against the
  // bottom of the page. Done by inflating rowPrefixSums IN PLACE, before any of its many consumers
  // below (borders, group outlines, the mock page's own height, drag/resize hit-testing, the
  // selection outline) ever read it — every one of them just sees the already-shifted coordinate
  // space and stays visually consistent with it automatically, with no need to touch each of them
  // individually. A real blank spacer <tr> (rendered further down) makes the same gap in the actual
  // table's native row flow, not just in these derived overlay coordinates. Only meaningful for a
  // project's own sheet (isProjectSheetView) — the company template builder has no per-project
  // hidden/included group state for this to react to, and always shows every row uncollapsed.
  let anchorSpacerPx = 0;
  let anchorSpacerBeforeRowIdx = -1;
  // rowPrefixSums[anchorStartRow] itself is read TWO different ways once a spacer's inserted: as the
  // top of the anchor row (wants the shift) and as the BOTTOM edge of whatever row/group ends right
  // before it (wants the row's own NATURAL boundary, not one inflated by a gap that isn't actually
  // part of it) — a single shared array can't hold both values at once. Defaults to rowPrefixSums
  // itself (same reference) so every consumer below is completely unaffected when no spacer applies.
  let rowBottomEdgeSums = rowPrefixSums;
  if (isProjectSheetView) {
    const anchoredGroups = expandedGroups.filter((g) => g.anchorFirstPageBottom && !g.hidden);
    if (anchoredGroups.length > 0) {
      const anchorStartRow = Math.min(...anchoredGroups.map((g) => g.startRow));
      const usableHeightPx = mockPageHeightPx - mockPageMarginPx * 2;
      const heightBeforeAnchorPx = rowPrefixSums[anchorStartRow] ?? 0;
      const heightFromAnchorPx = (rowPrefixSums[rowPrefixSums.length - 1] ?? 0) - heightBeforeAnchorPx;
      const requiredSpacerPx = usableHeightPx - heightBeforeAnchorPx - heightFromAnchorPx;
      if (requiredSpacerPx > 0.5) {
        // Captured before the shift below overwrites it — this row/group's own natural (un-inflated)
        // boundary, for anything that ends exactly here to measure its OWN bottom edge against.
        const naturalAnchorTop = rowPrefixSums[anchorStartRow];
        for (let i = anchorStartRow; i < rowPrefixSums.length; i += 1) rowPrefixSums[i] += requiredSpacerPx;
        rowBottomEdgeSums = rowPrefixSums.slice();
        rowBottomEdgeSums[anchorStartRow] = naturalAnchorTop;
        anchorSpacerPx = requiredSpacerPx;
        anchorSpacerBeforeRowIdx = anchorStartRow;
      }
    }
  }

  const borderSegments = computeBorderSegments(liveGrid, colPrefixSums, rowPrefixSums, rowBottomEdgeSums, hiddenRowIndexes);
  const groupOutlines = computeGroupOutlines(expandedGroups, rowPrefixSums, rowBottomEdgeSums);
  // Reuses computeGroupOutlines' own row-range-to-pixel-rect math (zonePreviewMode's `value` is
  // already cropped to start at the parent group's own row 0, same coordinate space a zone's own
  // startRow/endRow are stored in — see SpecsGroupZone's own comment) by shaping each zone as a
  // throwaway SpecsRowGroup-like object just for this calculation; nothing here is a real group.
  const previewZoneOutlines =
    zonePreviewMode && previewZones && previewZones.length > 0
      ? computeGroupOutlines(
          previewZones.map((z) => ({ id: z.id, name: "Editable Zone", startRow: z.startRow, endRow: z.endRow })),
          rowPrefixSums,
          rowBottomEdgeSums,
        )
      : [];
  // Same visible-group outlines, filtered down to the ones showEditableGroupBorders actually wants
  // drawn: hidden groups have no rows on screen at all in a project's own view already (nothing to
  // box), and a group the viewer can't edit (same check as isRowLockedForViewer, just per-group here
  // instead of per-row) is deliberately left unboxed — the whole point is showing which sections are
  // actually theirs to work on.
  const editableGroupOutlines = showEditableGroupBorders
    ? groupOutlines.filter((g) => {
        if (g.hidden) return false;
        const group = expandedGroups.find((eg) => eg.id === g.id);
        const isLocked = Boolean(
          canEditSpecsGroup && group?.editableByRoleIds && group.editableByRoleIds.length > 0 && !canEditSpecsGroup(group),
        );
        return !isLocked;
      })
    : [];
  const tableTotalWidthPx = colPrefixSums[colPrefixSums.length - 1] ?? 0;

  // The "mock page" the sheet sits in — a white rectangle sized to the actual paper dimensions
  // (so print can be visualized), surrounded by a grey canvas. Only ever grown, never shrunk, past
  // the paper size: if the table itself (say, after someone widens columns or adds many rows) ends
  // up bigger than one physical page, letting the white area grow with it keeps the table fully on
  // white rather than clipping it or spilling content onto the grey — the paper-size box is a visual
  // reference, not a hard crop.
  const mockPageWidthPx = Math.round(SPECS_PAGE_SIZES[liveGrid.pageSize].widthMm * MM_TO_PX);
  const tableRenderedWidthPx = rowHeaderWidthPx + tableTotalWidthPx + mockPageMarginPx * 2;
  const tableRenderedHeightPx = colHeaderHeightPx + (rowPrefixSums[rowPrefixSums.length - 1] ?? 0) + mockPageMarginPx * 2;
  // The floor this box is never allowed to shrink below (see the comment above) has to be expressed
  // in the SAME units as tableRenderedWidthPx for each view to actually agree once a sheet's columns
  // exactly fill the page. Project view already does, since its margin insets (added above) exactly
  // make up the difference between a full physical page and the printable area inside it — but the
  // builder swaps that margin for its row-header gutter instead (a DIFFERENT, unrelated width, per
  // the comment above), so comparing its narrower table against the raw physical page width left a
  // permanent gap on the right even for a sheet whose columns already fill their printable area.
  // Comparing against the same printable-area-plus-gutter figure the builder actually renders to
  // fixes that, while a genuinely-narrower-than-that sheet (columns resized down) still shows a
  // real, correctly-informative gap.
  const mockPageTargetWidthPx = isProjectSheetView
    ? mockPageWidthPx
    : getSpecsPageUsableWidthPx(liveGrid.pageSize) + rowHeaderWidthPx;
  // zonePreviewMode never applies the physical-page floor at all — it's a throwaway crop of just one
  // group's own rows, not a document meant to visualize print layout, so sizing it to a REAL page
  // (e.g. ~1122px tall for A4) would leave a huge blank area below a 2-10 row group. Using the
  // rendered content size directly is exactly "show only the cells that are part of the group."
  const mockPageBoxWidthPx = zonePreviewMode ? tableRenderedWidthPx : Math.max(mockPageTargetWidthPx, tableRenderedWidthPx);
  const mockPageBoxHeightPx = zonePreviewMode ? tableRenderedHeightPx : Math.max(mockPageHeightPx, tableRenderedHeightPx);

  // fitToViewportOnMobile: the page above is sized to real physical mm dimensions (mockPageBoxWidthPx
  // routinely exceeds a phone's own width), so it's wrapped in a scale-to-fit viewport instead of
  // left to overflow — sheetFitScale is the "whole page visible" baseline, sheetZoom (pinch) and
  // sheetPan (single-finger drag once zoomed in) layer on top of it, mirroring the project page's
  // own nesting sheet-preview pinch/pan (clampNestingPreviewOffset etc.) but scoped to this canvas
  // and self-contained here rather than driven by the host page.
  const sheetFitViewportRef = useRef<HTMLDivElement | null>(null);
  // Driven directly by window.innerWidth/innerHeight (always synchronously correct) rather than a
  // ResizeObserver reading sheetFitViewportRef's own clientWidth/Height — the ref version measured
  // unreliably early (before the table had finished its own width measurement/layout pass one
  // render up, in mockPageBoxWidthPx), leaving the scale stuck at whatever it read on that first,
  // sometimes-wrong pass with nothing to ever correct it.
  const [viewportInnerWidthPx, setViewportInnerWidthPx] = useState(typeof window === "undefined" ? 0 : window.innerWidth);
  const [viewportInnerHeightPx, setViewportInnerHeightPx] = useState(typeof window === "undefined" ? 0 : window.innerHeight);
  useEffect(() => {
    if (!fitToViewportOnMobile || typeof window === "undefined") return;
    const onResize = () => {
      setViewportInnerWidthPx(window.innerWidth);
      setViewportInnerHeightPx(window.innerHeight);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitToViewportOnMobile]);
  // Many sheets use a custom @font-face (e.g. a signature font) whose font-display: swap means a
  // fallback font renders immediately while the real one loads in the background — the same risk
  // lib/specs-grid-pdf.ts already has to work around for PDF export (see its own comment on
  // document.fonts.ready resolving before a never-yet-requested font is actually ready to draw
  // with). SpecsCellTextArea measures its own scrollHeight on mount to grow its row to fit (see
  // growRowForCellHeight) — if that first measurement happens against the FALLBACK font's metrics,
  // it can come out shorter than the real font eventually needs, and since a row's height only
  // ever grows, never shrinks, that too-short measurement sticks permanently once the real font
  // swaps in, with nothing left to ever correct it — the text now overflows a row/border sized for
  // the fallback font's shorter line count. A slow mobile connection/CPU is far more likely to
  // still be mid-font-load by the time cells first measure themselves than a fast desktop is,
  // which is why this specifically reads as "text and fill colour not lining up with the group
  // border" on mobile. Bumping this once fonts finish loading feeds into remeasureSignal below,
  // forcing every cell to re-measure itself against the REAL font and grow its row if it needs to.
  const [fontsReadyTick, setFontsReadyTick] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts?.ready?.then) return;
    let cancelled = false;
    // document.fonts.ready alone can resolve BEFORE a font that nothing has actually requested
    // yet finishes loading — see lib/specs-grid-pdf.ts's own identical comment on this exact API
    // footgun, for the same "Signature" font (app/quote-fonts.css's only @font-face). That PDF
    // path primes the font/size combo it's about to draw with via document.fonts.load() first;
    // here there's no single cell to key off, so explicitly request the one custom font this app
    // ships (app/quote-fonts.css has exactly one @font-face) — system fonts in
    // lib/quote-font-options.ts never need this, they're already available with no network fetch.
    const primeCustomFonts = typeof document.fonts?.load === "function" ? document.fonts.load('16px "Signature"').catch(() => {}) : Promise.resolve();
    primeCustomFonts
      .then(() => document.fonts.ready)
      .then(() => {
        if (!cancelled) setFontsReadyTick((t) => t + 1);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // The canvas has no horizontal padding of its own on mobile now (it bleeds past the host page's
  // own px-3/sm:px-4/md:px-5 wrapper too — see the canvas div's own className below), so the page
  // is meant to reach the true screen edges exactly — just a few px of safety margin against
  // rounding, since erring toward a hair smaller is harmless but erring the other way reintroduces
  // the "clipped off the right edge" bug this whole calculation exists to avoid.
  const SHEET_FIT_HORIZONTAL_INSET_PX = 4;
  // Width only, deliberately — per explicit feedback, the sheet's own SCALE must never be capped
  // by available height. A height cap sounds reasonable (keeps the whole page on screen at rest)
  // but in practice made the height-constrained render path the one that actually triggers the
  // text/fill-vs-border misalignment bug elsewhere in this file (SpecsCellTextArea's own
  // scrollHeight measurement, growRowForCellHeight) — a template that's either short enough or
  // tall enough to hit that second scale factor glitches, while a plain width-only scale (this)
  // never does. A page taller than the screen at this scale is meant to run past the bottom and
  // scroll with the rest of the view, same as print-size would on desktop — see the viewport div's
  // own height below (sheetFitMinHeightPx) for how the zoomable area still gets the FULL available
  // height to pan into even when the page itself is shorter than that, without this scale caring.
  const sheetFitScale =
    fitToViewportOnMobile && mockPageBoxWidthPx > 0
      ? Math.max(0.1, Math.min(1, (viewportInnerWidthPx - SHEET_FIT_HORIZONTAL_INSET_PX) / mockPageBoxWidthPx))
      : 1;
  // How tall the pinch-zoom/pan viewport (below) should be AT LEAST — the full room actually
  // available on screen (host title bar + this component's own toolbar spacer + canvas padding all
  // subtracted out), regardless of whether the scaled page itself is shorter than that. Without
  // this, a short page's viewport sized to just its own scaled content left genuine, un-zoomable
  // padding above/below it (the canvas's own flex-1 stretch only grows the grey BACKGROUND, not
  // this inner overflow:hidden box) — pinching in had nowhere to pan INTO across that gap, reading
  // as "it's there no matter how much I zoom, and it still cuts the sheet off." The viewport's own
  // style below takes Math.max of this and the page's real scaled height, so a TALL page still
  // grows taller than the screen and simply scrolls with the rest of the view, same as
  // sheetFitScale's own comment describes.
  const sheetFitMinHeightPx =
    fitToViewportOnMobile
      ? Math.max(0, viewportInnerHeightPx - (mobileTopOffsetPx ?? 0) - PROJECT_TOOLBAR_HEIGHT_PX - 24 - (canvasBottomInsetPx ?? 0))
      : 0;
  const [sheetZoom, setSheetZoom] = useState(1);
  const [sheetPan, setSheetPan] = useState({ x: 0, y: 0 });
  // Reports "is this sheet currently zoomed in at all" up to the host page, purely so ITS OWN
  // page-level gestures (the mobile Version History/Sections-or-Extras drawer swipe, see
  // makeSpecsQuoteMobileSwipeHandlers in the project page) can tell a genuine single-finger PAN
  // across zoomed-in content apart from an ordinary drag meant to open a drawer — both look
  // identical as raw touch deltas, which is all those page-level gesture handlers see, since this
  // sheet's own pan/pinch handlers below deliberately never call stopPropagation (see their own
  // comment on why: letting an ordinary one-finger drag still reach the host's pulldown/drawer
  // gestures when the sheet ISN'T zoomed is the whole point). zoom > 1 is "away from the true
  // edge" on its own — clampSheetPan below always resets sheetPan back to exactly {0, 0} the
  // moment zoom returns to 1, so there's no separate panned-but-not-zoomed case to also check.
  useEffect(() => {
    onSheetZoomedAwayFromEdge?.(sheetZoom > 1);
  }, [sheetZoom, onSheetZoomedAwayFromEdge]);
  // Resets back to "at the true edge" on UNMOUNT ONLY (tab switch, etc.) — a separate, empty-deps
  // effect rather than a cleanup on the one above: that effect's own cleanup would otherwise also
  // fire on every single intermediate zoom VALUE during an ordinary pinch (cleanup runs before
  // every re-run, not just on unmount), flickering the host's copy of this flag false then
  // immediately true again on every frame of an active pinch instead of changing once. Reads the
  // callback from a ref (kept fresh every render below) rather than closing over it directly, so
  // this still calls whatever the CURRENT prop is even though its own deps array never reruns it.
  const onSheetZoomedAwayFromEdgeRef = useRef(onSheetZoomedAwayFromEdge);
  onSheetZoomedAwayFromEdgeRef.current = onSheetZoomedAwayFromEdge;
  useEffect(() => {
    return () => onSheetZoomedAwayFromEdgeRef.current?.(false);
  }, []);
  const sheetGestureRef = useRef<{
    mode: "none" | "pinch" | "pan";
    startScale: number;
    startOffsetX: number;
    startOffsetY: number;
    startDistance: number;
    startCenterX: number;
    startCenterY: number;
    startPointX: number;
    startPointY: number;
  }>({
    mode: "none",
    startScale: 1,
    startOffsetX: 0,
    startOffsetY: 0,
    startDistance: 0,
    startCenterX: 0,
    startCenterY: 0,
    startPointX: 0,
    startPointY: 0,
  });
  // No explicit reset-on-content-change needed for sheetZoom/sheetPan: the host page already
  // remounts this whole component (specsSheetEditorKey/quoteGridEditorKey bump) whenever the
  // live/saved-version content actually swaps, which resets every piece of local state here,
  // these included, for free.
  // The content is transform-origin: top left (see the fit-scale comment on that transform below
  // for why — mx-auto collapses to 0 once the unscaled box is wider than its container, so the box
  // is already flush against the viewport's top-left corner, and scaling from that same corner is
  // what makes the shrunk-to-fit result land flush there too). At rest (sheetZoom 1) the content
  // exactly fills the viewport by definition of "fit", so zooming to sheetZoom makes it
  // viewportSize * sheetZoom on screen — pan can slide it left/up by up to that excess to reveal
  // the far edge, but never right/down past its own flush-left/top starting position (which would
  // just reveal blank space beyond the content's own left/top edge).
  const clampSheetPan = (x: number, y: number, zoom = sheetZoom) => {
    if (zoom <= 1) return { x: 0, y: 0 };
    const viewport = sheetFitViewportRef.current;
    if (!viewport) return { x: 0, y: 0 };
    const minX = -viewport.clientWidth * (zoom - 1);
    const minY = -viewport.clientHeight * (zoom - 1);
    return { x: Math.max(minX, Math.min(0, x)), y: Math.max(minY, Math.min(0, y)) };
  };
  const getSheetTouchDistance = (a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) =>
    Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  const onSheetViewportTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const viewport = sheetFitViewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const gesture = sheetGestureRef.current;
    if (event.touches.length >= 2) {
      const [first, second] = [event.touches[0], event.touches[1]];
      gesture.mode = "pinch";
      gesture.startScale = sheetZoom;
      gesture.startOffsetX = sheetPan.x;
      gesture.startOffsetY = sheetPan.y;
      gesture.startDistance = Math.max(1, getSheetTouchDistance(first, second));
      gesture.startCenterX = (first.clientX + second.clientX) / 2 - rect.left;
      gesture.startCenterY = (first.clientY + second.clientY) / 2 - rect.top;
      event.preventDefault();
      return;
    }
    if (event.touches.length === 1 && sheetZoom > 1) {
      gesture.mode = "pan";
      gesture.startScale = sheetZoom;
      gesture.startOffsetX = sheetPan.x;
      gesture.startOffsetY = sheetPan.y;
      gesture.startPointX = event.touches[0].clientX - rect.left;
      gesture.startPointY = event.touches[0].clientY - rect.top;
      event.preventDefault();
    }
  };
  const onSheetViewportTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const viewport = sheetFitViewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const gesture = sheetGestureRef.current;
    if (gesture.mode === "pinch" && event.touches.length >= 2) {
      const [first, second] = [event.touches[0], event.touches[1]];
      const nextDistance = Math.max(1, getSheetTouchDistance(first, second));
      const nextZoom = Math.max(1, Math.min(4, Number(((gesture.startScale * nextDistance) / gesture.startDistance).toFixed(3))));
      const centerX = (first.clientX + second.clientX) / 2 - rect.left;
      const centerY = (first.clientY + second.clientY) / 2 - rect.top;
      // Keeps whatever content point is under the fingers visually stable as zoom changes — derived
      // directly against the viewport's own top-left corner (no "recenter around the middle" term),
      // matching the content's actual transform-origin: top left (see clampSheetPan's own comment).
      const unclampedX = centerX - ((gesture.startCenterX - gesture.startOffsetX) / gesture.startScale) * nextZoom;
      const unclampedY = centerY - ((gesture.startCenterY - gesture.startOffsetY) / gesture.startScale) * nextZoom;
      setSheetZoom(nextZoom);
      setSheetPan(clampSheetPan(unclampedX, unclampedY, nextZoom));
      event.preventDefault();
      return;
    }
    if (gesture.mode === "pan" && event.touches.length === 1 && gesture.startScale > 1) {
      const pointX = event.touches[0].clientX - rect.left;
      const pointY = event.touches[0].clientY - rect.top;
      setSheetPan(clampSheetPan(gesture.startOffsetX + (pointX - gesture.startPointX), gesture.startOffsetY + (pointY - gesture.startPointY), gesture.startScale));
      event.preventDefault();
    }
  };
  const onSheetViewportTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const gesture = sheetGestureRef.current;
    if (event.touches.length === 0) {
      gesture.mode = "none";
    }
  };

  // fitToViewportOnMobile only: tapping a cell focuses its contentEditable (SpecsCellTextArea's own
  // onFocus), and mobile Safari's own "scroll the newly-focused element into view" behavior doesn't
  // reliably account for an ancestor `transform: scale()` at the fractional values this view
  // actually uses — it can scroll the page's own scroll container by a wildly wrong distance,
  // landing on a completely different part of the sheet and reading as "tapping a cell selected a
  // different row" (this sheet is already fully visible by design — the fit-to-viewport wrapper is
  // `overflow: hidden` specifically so nothing ever NEEDS scrolling into view — so there's nothing
  // for the browser to legitimately be correcting for here). Rather than diagnosing the browser's
  // own miscalculation, this snapshots the scroll position the instant focus fires and keeps
  // re-asserting it for long enough to outlast even an animated native auto-scroll, canceling out
  // whatever the browser just did regardless of how it got there. A no-op whenever the browser
  // doesn't actually scroll (the scrollTop/scrollLeft checks skip the write entirely).
  const cancelNativeFocusScrollOnMobile = () => {
    if (typeof document === "undefined") return;
    const scrollEl: Element | null = document.querySelector('[data-app-scroll-root="true"]') ?? document.scrollingElement;
    if (!scrollEl) return;
    const { scrollTop, scrollLeft } = scrollEl;
    const deadline = performance.now() + 400;
    const restore = () => {
      if (scrollEl.scrollTop !== scrollTop) scrollEl.scrollTop = scrollTop;
      if (scrollEl.scrollLeft !== scrollLeft) scrollEl.scrollLeft = scrollLeft;
      if (performance.now() < deadline) requestAnimationFrame(restore);
    };
    requestAnimationFrame(restore);
  };

  // The grip handle's own hover keeps a group "active" even once the pointer has moved off its rows
  // and onto the handle itself (see manuallyHoveredGroupId's own comment) — falls back to whichever
  // group the currently-hovered ROW belongs to otherwise.
  const hoveredGroupId = manuallyHoveredGroupId ?? (hoveredRowIndex !== null ? (findRowGroupForRow(expandedGroups, hoveredRowIndex)?.id ?? null) : null);
  useEffect(() => {
    onHoveredGroupChange?.(hoveredGroupId);
  }, [hoveredGroupId, onHoveredGroupChange]);
  const restorableDeletedGroups = (liveGrid.deletedGroups ?? []).filter((dg) => !liveGrid.groups.some((g) => g.id === dg.id));
  // Every distinct category already used by another group in this sheet, in first-seen order — fed
  // into the group modal's own Category field as a <datalist> so picking the SAME category on a
  // second group is a matter of reusing a suggestion, not retyping it exactly (a mistyped duplicate,
  // e.g. "Handles" vs "handles ", would otherwise silently split into two headings in the sidebar
  // instead of the one the person meant to build).
  const groupCategoryOptions = Array.from(
    new Map(
      liveGrid.groups
        .map((g) => g.category?.trim())
        .filter((c): c is string => Boolean(c))
        .map((c) => [c.toLowerCase(), c] as const),
    ).values(),
  );

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
    <div
      // fitToViewportOnMobile: appended regardless of the passed className (both Quote/Specs call
      // sites pass a plain "flex w-full flex-col" with no height of its own) — without a definite
      // height here, the grey canvas below can't flex-1 to fill the REST of it (see the canvas's
      // own flex-1 in its fitToViewportOnMobile className) and instead only grows to its own A4-
      // page-driven content height. Whatever's left over below that (down to the docked mobile
      // Actions bar) then falls through to the host scroll container's own background, which reads
      // as a visible seam — a different, near-but-not-quite-matching grey — against this canvas's
      // own hardcoded color right where the two meet.
      className={`${className ?? "flex h-full w-full flex-col"}${fitToViewportOnMobile ? " h-full" : ""}`}
    >
      {isProjectSheetView ? (
        // Reserves the fixed toolbar's own flow space (see its own comment below for why it's
        // `position: fixed`) — without this, the canvas below would render up underneath it, since a
        // fixed element takes up zero space in normal flow. A plain static height (not measured) —
        // see the host page's own matching comment on why nothing here is JS-measured.
        // Always reserved, even once the sheet is locked for the client (isSentToClient) and the
        // toolbar's own BUTTONS stop rendering below — this bar's outer shell (this spacer, plus
        // the fixed strip's own background/border) stays in place either way, so the canvas/
        // belowToolbarBanner below it never loses its offset and doesn't end up rendering behind
        // the host page's own fixed header, and the strip's bottom border stays put as the same
        // visual boundary it always was.
        <div style={{ height: PROJECT_TOOLBAR_HEIGHT_PX }} />
      ) : null}
      <div
        // Marks this toolbar so the host page's own page-wide "swipe anywhere to open a drawer"
        // gesture (Specs/Quote mobile only) ignores touches starting here — this strip is already
        // its own horizontal scroller, and dragging across it to scroll would otherwise also get
        // read as a page-level swipe.
        data-specs-quote-swipe-exclude="true"
        className={
          isProjectSheetView
            ? "hide-native-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto p-2"
            : "flex flex-wrap items-center justify-center gap-1.5 p-2"
        }
        // zonePreviewMode: forced hidden via display:none rather than restructuring this whole
        // deeply-nested block's own conditional tree — the formatting toolbar is meaningless for a
        // throwaway, forced-read-only crop with a no-op onChange, and the user asked for it gone.
        style={
          zonePreviewMode
            ? { display: "none" }
            : isProjectSheetView
            ? {
                // No background/blur of its own — the host page renders ONE shared blurred backdrop
                // spanning from its own header down through this toolbar's own bottom edge, so the two
                // fixed bars read as a single continuous glass sheet with no seam between them. See
                // the host page's own comment (right above that shared backdrop) for the full
                // reasoning — every attempt at giving this toolbar its OWN independent blur, at any
                // position, produced a visible flashing/seam artifact in Chromium.
                position: "fixed",
                top: toolbarFixedTopPx ?? 0,
                left: toolbarFixedLeftPx ?? 0,
                right: toolbarFixedRightPx ?? 0,
                zIndex: 95,
                borderBottom: "1px solid var(--glass-border)",
                // Explicit, matching the spacer above and the host page's own coordinated backdrop
                // height — without it, this bar's height is only ever implied by its buttons (h-8 +
                // p-2 padding), so hiding every button once the sheet is locked for the client
                // (isSentToClient) collapsed it down to just its padding, leaving its own border —
                // and the host's "Version History"/"Quote Extras" buttons sitting alongside it at
                // the ORIGINAL height — no longer aligned with one another.
                height: PROJECT_TOOLBAR_HEIGHT_PX,
              }
            : { borderBottom: "1px solid var(--glass-border)" }
        }
      >
        {/* Buttons only — not the bar itself (see the spacer's own comment above) — hidden once
            the sheet is locked for the client (isSentToClient): applyChange already no-ops every
            edit the instant that's true, so a Bold/Underline/Undo bar sitting over fully
            read-only content is dead UI. Reuses the same isSentToClient the row/cell locks below
            already key off, rather than a stricter "formally accepted/submitted only" condition —
            the toolbar shouldn't outlive editability just because the client hasn't responded
            yet. */}
        {!isSentToClient && (
        <>
        <button
          type="button"
          disabled={!canUndo}
          onClick={undo}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border disabled:opacity-40"
          style={toolbarButtonStyle}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={redo}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border disabled:opacity-40"
          style={toolbarButtonStyle}
          title="Redo (Ctrl+Y)"
        >
          <Redo2 size={14} />
        </button>
        <div className="mx-0.5 h-6 w-px" style={{ backgroundColor: "var(--glass-border)" }} />
        {showPageSizeSelector ? (
          <>
            <label className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold" style={toolbarButtonStyle}>
              Sheet Size
              <select
                value={liveGrid.pageSize}
                onChange={(e) => applyChange(resizeGridToPageSize(liveGrid, e.target.value as SpecsPageSize), true)}
                className="appearance-none text-[11px] font-bold outline-none"
                style={{ color: "var(--text-main)", border: "none", background: "transparent" }}
              >
                {(Object.keys(SPECS_PAGE_SIZES) as SpecsPageSize[]).map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
            <div className="mx-1 h-6 w-px" style={{ backgroundColor: "var(--glass-border)" }} />
          </>
        ) : null}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyFormatCommand("bold")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border"
          style={toolbarButtonStyle}
          title="Bold (Ctrl+B) — highlight text to bold just that part, or select the whole cell to bold everything in it"
        >
          <Bold size={14} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyFormatCommand("underline")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border"
          style={toolbarButtonStyle}
          title="Underline (Ctrl+U) — highlight text to underline just that part, or select the whole cell to underline everything in it"
        >
          <Underline size={14} />
        </button>
        <label className="inline-flex h-8 items-center gap-1 rounded-[8px] border pl-2 pr-1.5 text-[11px] font-bold" style={toolbarButtonStyle} title="Font">
          <select
            key={activeCell ? `${activeCell.row}:${activeCell.col}` : "none"}
            defaultValue={activeCell?.cell?.style?.fontFamily ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              // Firestore's setDoc rejects a literal `undefined` property value outright — "Default"
              // has to be an absent key, not a present one holding `undefined`.
              toggleStyle((s) => {
                if (value) return { ...s, fontFamily: value };
                const next = { ...s };
                delete next.fontFamily;
                return next;
              });
            }}
            // appearance-none strips the browser's own native form-control chrome so this reads as
            // plain text filling the label itself, not a separate control sitting inside it — the
            // label's own border is the only visible boundary; the manual ChevronDown right after
            // replaces the native arrow appearance-none also removes. border/background are set
            // INLINE, not just via the border-0/bg-transparent classes — a global `.cs-app select`
            // rule (app/globals.css) gives every <select> a real border + white background with
            // higher specificity than a single Tailwind utility class, so those classes alone
            // couldn't actually win against it; an inline style always overrides an external
            // stylesheet rule regardless of specificity.
            className="max-w-[100px] appearance-none text-[11px] font-bold outline-none"
            style={{ color: "var(--text-main)", border: "none", background: "transparent" }}
          >
            <option value="">Default</option>
            {SYSTEM_QUOTE_FONT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} style={{ fontFamily: opt.value }}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </label>
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
        {(() => {
          const CurrentAlignIcon = ALIGN_OPTIONS.find((o) => o.value === currentAlign)?.Icon ?? AlignLeft;
          return (
            <button
              type="button"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setAlignDropdown({ axis: "h", anchorRect: { left: rect.left, top: rect.bottom, width: rect.width, height: 0 } });
              }}
              className="inline-flex h-8 items-center gap-1 rounded-[8px] border px-1.5"
              style={toolbarButtonStyle}
              title="Horizontal alignment"
            >
              <CurrentAlignIcon size={14} />
              <ChevronDown size={12} />
            </button>
          );
        })()}
        <div className="mx-0.5 h-6 w-px" style={{ backgroundColor: "var(--glass-border)" }} />
        {(() => {
          const CurrentValignIcon = VALIGN_OPTIONS.find((o) => o.value === currentValign)?.Icon ?? AlignVerticalJustifyStart;
          return (
            <button
              type="button"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setAlignDropdown({ axis: "v", anchorRect: { left: rect.left, top: rect.bottom, width: rect.width, height: 0 } });
              }}
              className="inline-flex h-8 items-center gap-1 rounded-[8px] border px-1.5"
              style={toolbarButtonStyle}
              title="Vertical alignment"
            >
              <CurrentValignIcon size={14} />
              <ChevronDown size={12} />
            </button>
          );
        })()}
        <div className="mx-0.5 h-6 w-px" style={{ backgroundColor: "var(--glass-border)" }} />
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
        <button
          type="button"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const popoverWidth = 230;
            const viewportWidth = Math.max(120, document.documentElement?.clientWidth || window.innerWidth);
            const clampedLeft = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - popoverWidth - 8));
            setBorderPopoverAnchorRect({ left: clampedLeft, top: rect.bottom, width: rect.width, height: 0 });
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold"
          style={toolbarButtonStyle}
          title="Border settings"
        >
          <BorderStateIcon style={activeCell?.cell?.style ?? {}} />
          Border
        </button>
        {companyLogoUrl && !isProjectSheetView ? (
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
          disabled={!canMerge && !canUnmerge}
          onClick={() => {
            if (canUnmerge && activeCell) {
              applyChange(unmergeCell(liveGrid, activeCell.row, activeCell.col), true);
            } else if (canMerge && selection) {
              applyChange(mergeSelection(liveGrid, selection), true);
            }
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold disabled:opacity-40"
          style={toolbarButtonStyle}
          title={canUnmerge ? "Unmerge cells" : "Merge cells"}
        >
          {canUnmerge ? <TableCellsSplit size={14} /> : <TableCellsMerge size={14} />}
          {canUnmerge ? "Unmerge" : "Merge"}
        </button>
        {/* "Mark for Confirmation" used to live here as a plain toolbar button (for the live project
            view) — moved out to a floating side button (see the FloatingSideButton render further
            down, next to the "Import from Quote" one) so it sits right next to whatever's actually
            selected instead of a fixed toolbar slot. The TEMPLATE builder's own "Mark Confirmable"
            button below is a different thing: it pre-sets cell.confirmable on the template itself
            (see toggleCellConfirmable's own comment on what that field means), so every project
            cloned from it already has that cell ready as a Yes/No question — no need for staff to
            re-mark it by hand in every single project. */}
        {isProjectSheetView ? null : (
          <>
            <div className="mx-1 h-6 w-px" style={{ backgroundColor: "var(--glass-border)" }} />
            {allowConfirmationMarking ? (
              <button
                type="button"
                disabled={!activeCell}
                onClick={() => {
                  // Every real (non-null) cell inside the current drag-highlighted rectangle — NOT
                  // just its top-left slot (activeCell), same reasoning as the live view's own
                  // former toolbar button (now the FloatingSideButton further down) used.
                  const dragRangeTargets = (() => {
                    if (!selection) return [];
                    const rect = normalizeRect(selection);
                    const out: { row: number; col: number }[] = [];
                    for (let r = rect.minRow; r <= rect.maxRow; r += 1) {
                      for (let c = rect.minCol; c <= rect.maxCol; c += 1) {
                        if (liveGrid.rows[r]?.cells[c]) out.push({ row: r, col: c });
                      }
                    }
                    return out;
                  })();
                  if (dragRangeTargets.length > 1) {
                    const allAlreadyAllowed = dragRangeTargets.every((t) => Boolean(liveGrid.rows[t.row]?.cells[t.col]?.confirmableAllowed));
                    setCellsConfirmableAllowed(dragRangeTargets, !allAlreadyAllowed);
                  } else if (activeCell) {
                    toggleCellConfirmableAllowed(activeCell.row, activeCell.col);
                  }
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold disabled:opacity-40"
                style={activeCell?.cell?.confirmableAllowed ? toolbarButtonActiveStyle : toolbarButtonStyle}
                title="Mark this cell confirmable — staff can then use that project's own 'Mark for Confirmation' button to actually turn it into a client Yes/No question, per project, per round"
              >
                <CheckSquare size={14} />
                {activeCell?.cell?.confirmableAllowed ? "Confirmable ✓" : "Mark Confirmable"}
              </button>
            ) : null}
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
          </>
        )}
        </>
        )}
      </div>
      {alignDropdown && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={alignDropdownRef}
              className="fixed z-[2000] overflow-hidden rounded-[10px] border p-1"
              style={{
                left: alignDropdown.anchorRect.left,
                top: alignDropdown.anchorRect.top + 4,
                borderColor: "var(--glass-border)",
                backgroundColor: "var(--glass-bg-strong)",
                backdropFilter: "blur(24px) saturate(180%)",
                WebkitBackdropFilter: "blur(24px) saturate(180%)",
                boxShadow: "var(--shadow-glass)",
              }}
            >
              {(alignDropdown.axis === "h" ? ALIGN_OPTIONS : VALIGN_OPTIONS).map((opt) => {
                const isActive = alignDropdown.axis === "h" ? currentAlign === opt.value : currentValign === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      if (alignDropdown.axis === "h") toggleStyle((s) => ({ ...s, align: opt.value as "left" | "center" | "right" }));
                      else toggleStyle((s) => ({ ...s, verticalAlign: opt.value as "top" | "middle" | "bottom" }));
                      setAlignDropdown(null);
                    }}
                    className="flex w-full items-center gap-2 whitespace-nowrap rounded-[6px] px-2 py-1.5 text-left text-[12px] hover:brightness-95"
                    style={isActive ? { backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" } : { color: "var(--text-main)" }}
                  >
                    <opt.Icon size={14} />
                    {opt.label}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
      {borderPopoverAnchorRect && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={borderPopoverRef}
              data-specs-layout-modal="true"
              className="fixed z-[2000] w-[230px] overflow-hidden rounded-[12px] border p-3"
              style={{
                left: borderPopoverAnchorRect.left,
                top: borderPopoverAnchorRect.top + 4,
                borderColor: "var(--glass-border)",
                backgroundColor: "var(--glass-bg-strong)",
                backdropFilter: "blur(24px) saturate(180%)",
                WebkitBackdropFilter: "blur(24px) saturate(180%)",
                boxShadow: "var(--shadow-glass)",
              }}
            >
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Sides</p>
              <div className="mb-3 flex items-center gap-1.5">
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
              </div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Color</p>
              <button
                type="button"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setColorPopover({ kind: "border", anchorRect: { left: rect.left, top: rect.bottom, width: rect.width, height: 0 } });
                }}
                className="mb-3 inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-bold"
                style={toolbarButtonStyle}
              >
                <span className="inline-block h-4 w-4 rounded-[4px] border-2" style={{ borderColor: activeCell?.cell?.style?.borderColor ?? "var(--text-main)" }} />
                Choose color
              </button>
              <label className="flex items-center justify-between gap-1.5 text-[11px] font-bold" style={{ color: "var(--text-main)" }} title="Border width">
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
                  className="h-8 w-16 rounded-[8px] border bg-transparent px-2 text-[11px] font-bold outline-none"
                  style={{ borderColor: "var(--glass-border)", color: "var(--text-main)" }}
                />
              </label>
            </div>,
            document.body,
          )
        : null}

      {isProjectSheetView && !hideSectionsBar && (liveGrid.groups.length > 0 || restorableDeletedGroups.length > 0) ? (
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
                {groupsSupportPricing && g.price ? (
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{g.price}</span>
                ) : null}
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
          sheet of paper, which doesn't have a dark mode.
          A project's own copy does NOT scroll internally (no overflow-auto/flex-1 here) — its host
          page owns the one shared scroll instead, so the fixed toolbar above (and the page's own
          fixed header, further up the DOM) can actually show this sheet's content passing behind them
          via the shared blur backdrop as the page scrolls. The company template builder keeps its own
          self-contained scroll (still bounded inside its own modal), unchanged. */}
      <div
        className={
          fitToViewportOnMobile
            ? // No horizontal padding, and bled out past the host page's own px-3/sm:px-4/md:px-5
              // wrapper (see the host's "flex-1 px-3 pb-3 sm:px-4..." div in
              // projects/[projectId]/page.tsx — matched breakpoint-for-breakpoint here so the
              // cancellation is exact at every width) — the white page below reaches the TRUE
              // screen edges with no grey canvas showing on either side, instead of sitting inset
              // inside two stacked paddings that don't belong to this component's own asked-for
              // "edge to edge" mobile layout.
              //
              // flex-1: grows to consume whatever's left of the root's own now-full height (see the
              // root div's own comment) below the fixed toolbar's flow spacer, instead of stopping
              // at its own A4-page-driven content height — on a phone taller than an A4 page scaled
              // to its width, that used to leave a gap of the host scroll container's OWN background
              // exposed between this canvas's real bottom edge and the docked mobile Actions bar, a
              // few shades off from this canvas's own hardcoded grey and reading as an out-of-place
              // seam right where they met. The mock page inside stays anchored to the TOP of this
              // now-taller canvas (mx-auto with no vertical centering) — only the grey backdrop
              // grows, the page itself is unaffected.
              "relative flex-1 py-6 -mx-3 sm:-mx-4 md:-mx-5"
            : zonePreviewMode
              ? // No flex-1 (nothing to stretch to fill — the host's own wrapper div already sizes
                // and scrolls this), and barely any padding — the whole point is showing only the
                // group's own cells, not a page-sized canvas around a handful of rows.
                "relative p-2"
              : isProjectSheetView
                ? "relative p-6"
                : "relative min-h-0 flex-1 overflow-auto p-6"
        }
        // Deliberately NOT inset by toolbarFixedLeftPx/RightPx — those two only steer the fixed
        // TOOLBAR's own bounds now (so its buttons stay clear of the host page's title labels/
        // bubbles sitting at the same height), not the canvas below it. The sheet stays centered at
        // its own natural width; any floating bubble the host page renders alongside it sits OVER
        // this canvas rather than narrowing it, so a small window doesn't fight the sheet for width.
        style={{
          // #eef1f8: this token's own light-mode value, copied verbatim rather than referencing
          // var(--bg-app) directly (this canvas is hardcoded/theme-independent on purpose — it
          // represents a physical sheet's own surrounding mat, not page chrome) — the two used to
          // be a few shades apart, which read as a visible seam wherever they met.
          backgroundColor: "#eef1f8",
          // Added on top of the base 24px (p-6 above) rather than replacing it, so the host's
          // floating action bar gets its own reserved room INSIDE this grey canvas — its background
          // — instead of the host page reserving that space itself further down, past this canvas's
          // own bottom edge, where the page's own (differently-colored) background would show through.
          // On mobile (fitToViewportOnMobile), the caller's own canvasBottomInsetPx value already
          // IS the full reserved amount (matching the docked mobile action bar's own height exactly,
          // "no extra gap" — see its own comment in projects/[projectId]/page.tsx) — adding the base
          // 24 on top of that here double-counted it, opening an extra 24px gap between the sheet's
          // real content and the action bar that shouldn't have been there.
          ...(canvasBottomInsetPx
            ? { paddingBottom: fitToViewportOnMobile ? canvasBottomInsetPx : 24 + canvasBottomInsetPx }
            : {}),
          // On mobile, no top padding either — same "edge to edge" reasoning the className's own
          // comment gives for the horizontal bleed, just applied vertically too: the page starts
          // immediately below the fixed toolbar's own flow spacer, nothing left for a zoomed-in
          // pinch to find itself blocked by right at the top the way an un-zoomable, locked-in-
          // place gap used to read. py-6's own 24px top value only still applies off mobile.
          ...(fitToViewportOnMobile ? { paddingTop: 0 } : {}),
        }}
      >
        {/* fitToViewportOnMobile: a fixed-height, overflow-hidden viewport the page below is scaled
            down INTO (transform: scale, not a layout-affecting resize — the mm-accurate table inside
            stays exactly as-authored) so it starts fully visible on a phone screen instead of
            overflowing off the right edge. sheetZoom/sheetPan (pinch/pan, see their own state
            comments above) layer a user-controlled zoom-in on top of this base fit, clipped to this
            same viewport rather than growing it, matching a standard photo-viewer feel. */}
        <div
          ref={fitToViewportOnMobile ? sheetFitViewportRef : undefined}
          onTouchStart={fitToViewportOnMobile ? onSheetViewportTouchStart : undefined}
          onTouchMove={fitToViewportOnMobile ? onSheetViewportTouchMove : undefined}
          onTouchEnd={fitToViewportOnMobile ? onSheetViewportTouchEnd : undefined}
          // Deliberately NOT data-app-gesture-exempt: that marker blocks a touch starting here from
          // ever arming the host page's own pulldown-to-reveal-nav or swipe-open-a-drawer gestures
          // AT ALL, single-finger drags included — which also blocked a genuine single-finger
          // drag-down on the sheet preview from ever revealing the pulldown nav bar. A pinch's two
          // fingers reading as a page-level swipe is instead handled more precisely by the
          // event.touches.length > 1 checks already in app-shell.tsx's onMainTouchStart/Move and
          // this page's own makeSpecsQuoteMobileSwipeHandlers — those only bail out for an actual
          // multi-touch gesture, leaving an ordinary one-finger drag here free to reach them.
          style={
            fitToViewportOnMobile
              ? {
                  overflow: "hidden",
                  // Math.max, not just the page's own scaled height — see sheetFitMinHeightPx's
                  // own comment: a short page still gets the FULL available screen height here (so
                  // pinch-zoom has real room to pan into instead of hitting this box's own edge a
                  // moment after unscaled padding would have started), while a page taller than
                  // that genuinely grows past it and scrolls with the rest of the view.
                  height: Math.max(mockPageBoxHeightPx * sheetFitScale, sheetFitMinHeightPx),
                  touchAction: sheetZoom > 1 ? "none" : "pan-y",
                }
              : undefined
          }
        >
        <div
          className="relative mx-auto"
          style={{
            width: mockPageBoxWidthPx,
            minHeight: mockPageBoxHeightPx,
            backgroundColor: "#ffffff",
            boxShadow: "0 1px 4px rgba(16, 24, 40, 0.15)",
            ...(fitToViewportOnMobile
              ? {
                  // top left, not top center: with mx-auto's margins collapsing to 0 once the
                  // unscaled box (its real width, mockPageBoxWidthPx, unaffected by transform) is
                  // wider than its container, the box already sits flush at the container's LEFT
                  // edge — scaling around its own (much further right) unscaled center left the
                  // visible, shrunk content still off-center and partly clipped past the right
                  // edge. Scaling from the same top-left corner it's already flush against keeps
                  // the shrunk result flush there too, filling the viewport from x=0.
                  transform: `scale(${sheetFitScale * sheetZoom}) translate(${sheetPan.x / (sheetFitScale * sheetZoom)}px, ${sheetPan.y / (sheetFitScale * sheetZoom)}px)`,
                  transformOrigin: "top left",
                  // Forces this whole subtree (the table plus every absolutely-positioned overlay on
                  // top of it — borders, selection rings, the row/column headers) onto its own GPU
                  // compositing layer, rasterized ONCE at native resolution and then scaled as a
                  // single bitmap — rather than leaving mobile Safari free to hint/snap text and
                  // border overlays independently post-transform, which is what let them drift apart
                  // from each other (a border ending up visibly offset from the text it's meant to
                  // wrap) at the fractional scale factors mobile actually uses to fit a physical page
                  // to a phone's width. Only shows up scaled down — at 1:1 (desktop, no transform)
                  // there's nothing for the two to independently round away from each other.
                  willChange: "transform",
                  WebkitBackfaceVisibility: "hidden",
                }
              : {}),
          }}
        >
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
            {isCompactPreview ? null : <col style={{ width: rowHeaderWidthPx }} />}
            {safeColumnWidths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          {isCompactPreview ? null : (
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
              // Only ever meaningful once canEditSpecsGroup is actually supplied (the live project
              // window — see its own comment on SpecsGridEditorProps) and this row's group actually
              // restricts editing to specific roles; every other row/host stays fully editable.
              const rowGroupForRow = findRowGroupForRow(expandedGroups, rowIdx);
              const isRowLockedForViewer = Boolean(
                canEditSpecsGroup && rowGroupForRow?.editableByRoleIds && rowGroupForRow.editableByRoleIds.length > 0 && !canEditSpecsGroup(rowGroupForRow),
              );
              // Once a group has ANY zones defined, only rows inside one of them stay editable — see
              // SpecsRowGroup.zones' own comment. A group with no zones is unaffected (opt-in).
              // isProjectSheetView-gated: the zone lock only ever applies in a live project's actual
              // Quote/Specifications window, never in the Company Settings template builder, where
              // the whole group stays freely editable (even though zones are still defined/linked
              // there, via the Group Preview — authoring a zone and being RESTRICTED to it are
              // deliberately different things here).
              const isRowOutsideZone = Boolean(isProjectSheetView && rowGroupForRow?.zones?.length && !isRowWithinGroupZone(rowGroupForRow, rowIdx));
              // Same protection as the left-hand delete button above (see removeRowAt's own
              // disabled state) — a row containing a cell the client has actually answered
              // (Yes or No) can't have its text edited either, for the same reason: changing what
              // the client was shown/agreed to after the fact would make their answer meaningless.
              // Also locked the moment the WHOLE sheet has been sent (isSentToClient), even before
              // any individual cell has an answer yet — the client could be looking at any row the
              // instant it's sent, not only ones already answered.
              const isRowAnsweredByClient = Boolean(isSentToClient) || row.cells.some((c) => c && c.confirmable && c.confirmedYes !== undefined);
              return (
              <Fragment key={row.id}>
                {rowIdx === anchorSpacerBeforeRowIdx ? (
                  // The real, native-table-flow counterpart to the rowPrefixSums shift computed
                  // above — that shift alone only moves the OVERLAYS (borders, outlines, selection)
                  // and this row's own visual `top`; the table's actual row stacking still needs an
                  // actual blank row to open up the same gap, or every row from here on would just
                  // sit directly under the previous one regardless of the shifted coordinate space.
                  <tr aria-hidden="true">
                    <td colSpan={liveGrid.columnWidths.length} style={{ height: anchorSpacerPx, padding: 0, border: "none", background: "transparent" }} />
                  </tr>
                ) : null}
                <tr
                  style={{
                    height: safeRowHeights[rowIdx],
                    transform: dragShiftPx ? `translateY(${dragShiftPx}px)` : undefined,
                    transition: draggingGroupId || draggingDeletedGroupId ? "transform 150ms ease" : undefined,
                  }}
                  onMouseEnter={isProjectSheetView ? () => setHoveredRowIndex(rowIdx) : undefined}
                  onMouseLeave={isProjectSheetView ? () => setHoveredRowIndex((prev) => (prev === rowIdx ? null : prev)) : undefined}
                >
                {isCompactPreview ? null : (
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
                  const isCtrlMarked = ctrlMarkedCells.has(key);
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
                  // See SpecsGridEditorProps.lockUngroupedBlankCells's own comment — this is a
                  // structural rule (blank content + outside any group), not a per-role permission,
                  // so it applies to every viewer regardless of canEditSpecsGroup/owner/admin.
                  const isUngroupedBlankCell = Boolean(
                    lockUngroupedBlankCells && !rowGroupForRow && !cell.imageUrl && !cell.text.trim(),
                  );
                  // Single source of truth for "can this specific cell's text actually be edited" —
                  // feeds both SpecsCellTextArea's own readOnly prop and the wrapper's cursor below,
                  // so the mouse cursor never promises editability the cell doesn't actually have.
                  // zonePreviewMode forces this false unconditionally — this instance is a throwaway
                  // preview for marking zones, never a place to actually type (see its own comment).
                  const isCellTextEditableHere =
                    !zonePreviewMode && !(isRowLockedForViewer || isUngroupedBlankCell || isRowAnsweredByClient || isRowOutsideZone);
                  // Gates the mobile long-press-to-confirm gesture below — only a cell the TEMPLATE
                  // actually marked confirmableAllowed gets it, same restriction the desktop floating
                  // button already enforces (see computeMarkForConfirmationTarget's own comment).
                  const isMobileConfirmEligible =
                    fitToViewportOnMobile && isProjectSheetView && allowConfirmationMarking && Boolean(cell.confirmableAllowed);
                  // Gates the mobile long-press-to-import gesture below — same row-inside-a-linked-
                  // zone restriction the desktop floating button already enforces, just checked for
                  // THIS one row instead of against a whole selection (see findImportTargetForRow's
                  // own comment). Checked ahead of isMobileConfirmEligible at the handler-spread
                  // below (not here) so Import wins on the rare cell eligible for both.
                  const isMobileImportEligible =
                    fitToViewportOnMobile && isProjectSheetView && !isSentToClient && Boolean(quoteGridForLinkedPull) && Boolean(findImportTargetForRow(rowIdx));
                  return (
                    <td
                      key={key}
                      data-row={rowIdx}
                      data-col={colIdx}
                      colSpan={colSpan > 1 ? colSpan : undefined}
                      rowSpan={rowSpan > 1 ? rowSpan : undefined}
                      onMouseDown={(e) => {
                        if (isUngroupedBlankCell) return;
                        // Ctrl/Cmd+click is its own, entirely separate interaction — toggles this
                        // cell's membership in ctrlMarkedCells (the "Mark for Confirmation" bulk
                        // multi-select, project view only) and never touches the normal single-
                        // rectangle `selection` every other toolbar action reads. Excludes a right-
                        // click (button 2) so Ctrl+right-click still opens the usual context menu.
                        if (isProjectSheetView && (e.ctrlKey || e.metaKey) && e.button !== 2) {
                          setCtrlMarkedCells((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                          return;
                        }
                        // Any OTHER click drops whatever Ctrl+click multi-select was in progress —
                        // it's a transient aid for the one bulk action, not meant to linger through
                        // an unrelated normal click.
                        if (ctrlMarkedCells.size > 0) setCtrlMarkedCells(new Set());
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
                        if (isUngroupedBlankCell) return;
                        if (!isSelectingRef.current) return;
                        setSelection((prev) => (prev ? { ...prev, focusRow: rowIdx, focusCol: colIdx } : prev));
                      }}
                      {...(isMobileImportEligible
                        ? mobileImportLongPress.makeHandlers(rowIdx, colIdx, () => {
                            // Re-resolved fresh here (not captured once at render time) since this
                            // fires up to PRESS_MS later — recentlyImportedGroupIds (for the
                            // justImported label) could have changed in the meantime.
                            const importTarget = findImportTargetForRow(rowIdx);
                            if (!importTarget) return null;
                            setSelection({ anchorRow: rowIdx, anchorCol: colIdx, focusRow: rowIdx, focusCol: colIdx });
                            const justImported = Boolean(recentlyImportedGroupIds[importTarget.groupId]);
                            return {
                              label: justImported ? "Imported" : "Import from Quote",
                              title: `Import "${importTarget.groupName}" from its editable zone's linked Quote group(s)`,
                              onClick: () => requestImportLinkedQuoteTextIntoZoneForGroup(importTarget.groupId),
                            };
                          })
                        : isMobileConfirmEligible
                          ? mobileConfirmLongPress.makeHandlers(rowIdx, colIdx, () => {
                              // Only collapses the selection down to just this one cell when it
                              // ISN'T already part of a bigger multi-cell selection (e.g. one just
                              // built via the drag handles above) — holding a cell that's already
                              // inside a deliberately highlighted range should act on the WHOLE
                              // range, not shrink the highlight down to whichever single cell the
                              // hold happened to land on right as the popup opens.
                              const existingRect = selection ? normalizeRect(selection) : null;
                              const isExistingMultiCellSelection = Boolean(
                                existingRect && (existingRect.minRow !== existingRect.maxRow || existingRect.minCol !== existingRect.maxCol),
                              );
                              const pressedCellAlreadyInSelection = isExistingMultiCellSelection && isCellInRect(rowIdx, colIdx, existingRect!);
                              if (!pressedCellAlreadyInSelection) {
                                setSelection({ anchorRow: rowIdx, anchorCol: colIdx, focusRow: rowIdx, focusCol: colIdx });
                              }
                              // forceFallbackCellOnly: !pressedCellAlreadyInSelection — when true,
                              // this is the SAME synchronous tick as the setSelection(...) call just
                              // above that replaced whatever used to be selected, so reading
                              // `selection` inside computeMarkForConfirmationTarget would still see
                              // that stale, about-to-be-replaced value (see that param's own
                              // comment). When pressedCellAlreadyInSelection is true, nothing was
                              // just changed — `selection` is already accurate, so the normal
                              // derivation is used.
                              const target = computeMarkForConfirmationTarget({ row: rowIdx, col: colIdx }, !pressedCellAlreadyInSelection);
                              return target ? { label: target.label, title: target.title, onClick: target.onClick } : null;
                            })
                          : {})}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (isUngroupedBlankCell) return;
                        // zonePreviewMode gets its own, completely different right-click: there are
                        // no real SpecsRowGroup entries in this cropped grid to open the normal
                        // "Group" menu against, so right-clicking a row inside one of the host's
                        // previewZones instead reports it up via onZoneContextMenu — the host (which
                        // owns linkedQuoteSourceGrid) renders its own "Link to Quote Groups" menu for
                        // that zone. A row outside any zone does nothing; there's nothing to
                        // configure there in this mode.
                        if (zonePreviewMode) {
                          const zone = (previewZones ?? []).find((z) => rowIdx >= z.startRow && rowIdx <= z.endRow);
                          if (zone) onZoneContextMenu?.(zone.id, e.clientX, e.clientY);
                          return;
                        }
                        // Group management (create/add-to/remove a group) is a TEMPLATE-authoring
                        // concern now — groups, zones, and Quote links are all configured in the
                        // Company Settings template builder, never inside a live project's own
                        // Quote/Specifications window. Right-click there does nothing at all (not
                        // even the browser's own native menu, already suppressed above) rather than
                        // exposing group management staff were never meant to touch per-project.
                        if (isProjectSheetView) return;
                        // Right-clicking a data cell opens the exact same row-grouping menu as
                        // right-clicking the row number — "highlight any row OR individual cell and
                        // add it to a group" — reusing headerContextMenu's row-axis rendering, which
                        // already derives the row range from the current selection when it's
                        // multi-row, falling back to just this cell's own row otherwise.
                        setHeaderContextMenu({ axis: "row", index: rowIdx, x: e.clientX, y: e.clientY });
                      }}
                      className={cell.imageUrl ? "group p-0" : "p-0"}
                      style={{
                        position: "relative",
                        height: spannedHeightPx,
                        overflow: "hidden",
                        cursor: isUngroupedBlankCell ? "default" : undefined,
                        // Holding this cell long enough to open the Mark for Confirmation dropdown
                        // (isMobileConfirmEligible — see its own onTouchStart above) also crosses the
                        // SAME duration the browser's own native "select this text" hold gesture
                        // uses, independent of anything React's touch handlers do or don't
                        // preventDefault — without suppressing it here, the cell's own text shows up
                        // highlighted (and iOS additionally pops its copy/look-up callout) right as
                        // the dropdown appears. Same WebkitUserSelect/userSelect/WebkitTouchCallout
                        // trio useLongPress's own style already applies for its other long-press
                        // usages elsewhere in this app, for the identical reason.
                        ...(isMobileConfirmEligible
                          ? { WebkitUserSelect: "none" as const, userSelect: "none" as const, WebkitTouchCallout: "none" as const }
                          : {}),
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
                        // A confirmable cell gets a persistent colored inset border so staff can spot
                        // marked cells at a glance without needing to click into each one — only
                        // meaningful in a project's own sheet (isProjectSheetView), never the company
                        // template builder, matching the toolbar toggle's own gating. A cell currently
                        // in the Ctrl+click multi-select (isCtrlMarked) gets the SAME ring as a
                        // normal drag-highlighted selection (selectionOutline, below) — same
                        // brand-blue 2px inset — so it reads as "selected," not a separate status.
                        boxShadow: isCtrlMarked
                          ? "inset 0 0 0 2px var(--brand-strong)"
                          : isProjectSheetView
                            ? cell.confirmable
                              ? "inset 0 0 0 2px var(--brand-strong)"
                              : undefined
                            : gridlineBoxShadow(rowIdx === 0, colIdx === 0),
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
                          onMouseDown={(e) => {
                            // SpecsCellTextArea's own contentEditable div is left its natural height
                            // (see its own comment) and only vertically positioned within this taller
                            // wrapper — a short line of text in a tall (often merged) cell leaves real
                            // empty space above/below it that isn't part of that div at all. Clicking
                            // directly on the text already places the caret correctly via the browser's
                            // own native handling (e.target would be that div, not this wrapper); this
                            // only steps in for a click that landed in that empty space instead, where
                            // there's nothing for the browser to focus on its own.
                            if (e.target !== e.currentTarget) return;
                            const editable = e.currentTarget.querySelector<HTMLElement>('[contenteditable="true"]');
                            if (!editable) return;
                            e.preventDefault();
                            editable.focus();
                            // Deferred a frame: placing the selection synchronously, right alongside
                            // focus() in the same mousedown handler, left the caret focused but not
                            // actually rendering/blinking in testing — the browser's own native
                            // click-to-place-caret handling for a contentEditable element runs slightly
                            // later (on the same click gesture) and was winning the race, silently
                            // discarding the range set here. Waiting a frame lets that native handling
                            // finish first, so this one lands last and actually sticks.
                            requestAnimationFrame(() => {
                              const range = document.createRange();
                              range.selectNodeContents(editable);
                              range.collapse(false);
                              const sel = window.getSelection();
                              sel?.removeAllRanges();
                              sel?.addRange(range);
                            });
                          }}
                          style={{
                            height: spannedHeightPx,
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent:
                              style.verticalAlign === "middle" ? "center" : style.verticalAlign === "bottom" ? "flex-end" : "flex-start",
                            // The actual contentEditable div (SpecsCellTextArea) already gets the
                            // browser's own native text (I-beam) cursor for free just by being
                            // contentEditable — but it's left at its own natural height (see its own
                            // comment) and only positioned within this taller wrapper, so a short line
                            // in a tall (often merged) cell leaves empty space around it that's just a
                            // plain div, defaulting back to the ordinary pointer. Matching the cursor
                            // here too means every clickable-to-edit pixel in the cell LOOKS clickable,
                            // not just the exact rows the text happens to occupy.
                            cursor: isCellTextEditableHere ? "text" : undefined,
                          }}
                        >
                          <SpecsCellTextArea
                            cellKey={key}
                            runs={getCellRuns(cell)}
                            style={style}
                            isFocused={focusedKey === key}
                            onFocusCell={() => {
                              setFocusedKey(key);
                              if (fitToViewportOnMobile) cancelNativeFocusScrollOnMobile();
                            }}
                            onBlurCommitRuns={(runs) => {
                              setFocusedKey((prev) => (prev === key ? null : prev));
                              commitCellRuns(rowIdx, colIdx, runs);
                            }}
                            onLiveCommitRuns={(runs) => commitCellRuns(rowIdx, colIdx, runs)}
                            onToggleWholeCellFormat={(formatKey) => toggleCellRunsAt(rowIdx, colIdx, formatKey)}
                            onNaturalHeightChange={(px) => growRowForCellHeight(rowIdx, colIdx, cell, px)}
                            // Summed, not passed separately — remeasureSignal is only ever compared
                            // for change (see its own comment: "its actual value is never read"),
                            // so a combined value that changes whenever EITHER input does serves
                            // the same purpose without widening SpecsCellTextArea's own props.
                            remeasureSignal={mockPageBoxWidthPx + fontsReadyTick}
                            readOnly={!isCellTextEditableHere}
                            readOnlyReason={
                              isRowAnsweredByClient
                                ? isSentToClient
                                  ? "This sheet has been sent to the client and can't be edited — save a version first to make changes"
                                  : "This row has a client-confirmed answer and can't be edited"
                                : isUngroupedBlankCell && !isRowLockedForViewer
                                  ? "Blank cells outside a section can't be edited"
                                  : undefined
                            }
                            // A sheet locked because it was sent to the client (isSentToClient) is
                            // just a normal, fully-readable snapshot of what the client is seeing —
                            // not a permission restriction — so it stays full-opacity black text
                            // instead of the dimmed treatment used for an actual permission lock or
                            // an ungrouped blank cell. Also skipped for a cell locked purely for being
                            // outside the group's editable zone — that's not a permission restriction
                            // either, just a non-editable PART of an otherwise normal group, so its
                            // text should read exactly as authored rather than looking greyed-out.
                            dimmed={!isSentToClient && !isRowOutsideZone}
                          />
                        </div>
                      )}
                      {/* Read-only status for a confirmable cell — this editor never writes
                          confirmedYes/confirmedAt itself, only the public
                          app/api/specs-share/[shareId]/answer route does, and only ever onto the
                          specific SAVED VERSION document bound at send time — never back onto the
                          live sheet (see isViewingSavedVersion's own comment). A real Yes/No answer
                          therefore only ever renders while that saved version is open — the live
                          grid's own copy of confirmedYes/confirmedAt is permanently stale the
                          moment a version's been sent, and would misleadingly show a frozen answer
                          forever regardless of what the client's actually since said. "Pending" has
                          no such staleness risk (an unanswered marked cell really is pending,
                          whether you're looking at the live sheet or a saved version, since nothing
                          about "no answer yet" can go stale) and shows on both. Fills the ENTIRE
                          cell (matching the client's own full-cell Yes/No fill — see
                          components/specs-grid-client-view.tsx) rather than a small corner badge,
                          so staff can read a cell's status at a glance without needing to zoom in —
                          same treatment for "Pending" (still-unanswered) as for a real Yes/No, just
                          neutral colors so it doesn't misleadingly read as an actual answer. */}
                      {isProjectSheetView && allowConfirmationMarking && cell.confirmable && (isViewingSavedVersion || cell.confirmedYes === undefined) ? (
                        cell.confirmedYes === undefined ? (
                          <div
                            className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] font-bold"
                            style={{ backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
                            title="Waiting on the client"
                          >
                            Pending
                          </div>
                        ) : (
                          // No z-index (and no invented border of our own) — this cell's real
                          // explicit border, if the template author drew one, is rendered by the
                          // SEPARATE overlay below (see computeBorderSegments) as a plain sibling of
                          // the whole <table>, painted in normal DOM order. Giving this fill a
                          // positive z-index (as it briefly had) outranks that overlay's own
                          // default stacking and paints OVER it regardless of DOM order — hiding
                          // the template's actual border and leaving only a hand-drawn stand-in
                          // that didn't match its real width/color. Without z-index here, the real
                          // border shows through exactly as it does on every other cell.
                          <div
                            className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] font-bold"
                            style={cell.confirmedYes ? { backgroundColor: "var(--success-strong)", color: "#ffffff" } : { backgroundColor: "var(--danger-strong)", color: "#ffffff" }}
                            title={cell.confirmedAt ? `Answered ${new Date(cell.confirmedAt).toLocaleString()}` : undefined}
                          >
                            {cell.confirmedYes ? "Yes" : "No"}
                          </div>
                        )
                      ) : null}
                      {/* Template-builder-only equivalent of the live sheet's own Pending/Yes/No fill
                          just above — a confirmable cell has no such overlay to show here (nothing's
                          actually been sent/answered yet, and a project hasn't even been cloned from
                          this template), so without SOME indicator, "Mark Confirmable" would read as
                          doing nothing at all once clicked. Centered in the cell (both axes), same as
                          Pending/Yes/No above, rather than a corner tag. */}
                      {!isProjectSheetView && !zonePreviewMode && allowConfirmationMarking && cell.confirmableAllowed ? (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <span
                            className="whitespace-nowrap rounded-[4px] px-1 text-[9px] font-bold"
                            style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                          >
                            Confirmable
                          </span>
                        </div>
                      ) : null}
                    </td>
                  );
                })}
                </tr>
              </Fragment>
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
        {/* Never rendered at all (not just disabled) once the whole sheet is locked (isSentToClient)
            — a client could be looking at any row that instant, so there's nothing here to hover
            or grab in the first place, not just nothing it's allowed to do. */}
        {isProjectSheetView && !isSentToClient
          ? liveGrid.rows.map((row, rowIdx) => {
              if (hiddenRowIndexes.has(rowIdx)) return null;
              const isHovered = hoveredRowIndex === rowIdx;
              // A row the client has already answered (Yes OR No — confirmedYes !== undefined,
              // not just cell.confirmable) is locked against this button: deleting it would
              // silently throw away a real client decision with no way to recover it. Doesn't
              // affect a row that's merely marked confirmable but not yet answered — the
              // isSentToClient case is now handled by not rendering this at all (see above).
              const hasClientAnswer = row.cells.some((c) => c && c.confirmable && c.confirmedYes !== undefined);
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
                      disabled={hasClientAnswer}
                      onClick={() => {
                        if (hasClientAnswer) return;
                        removeRowAt(rowIdx);
                      }}
                      onMouseEnter={() => setLiftedButtonKey(`remove-${rowIdx}`)}
                      onMouseLeave={() => setLiftedButtonKey((prev) => (prev === `remove-${rowIdx}` ? null : prev))}
                      title={hasClientAnswer ? "This row has a client-confirmed answer and can't be deleted" : "Remove this row"}
                      className="flex h-4 w-4 items-center justify-center rounded-full transition-transform duration-150 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: hasClientAnswer ? "#9CA3AF" : "#EF4444",
                        color: "#ffffff",
                        transform: !hasClientAnswer && liftedButtonKey === `remove-${rowIdx}` ? "translateY(-2px)" : "none",
                        boxShadow: !hasClientAnswer && liftedButtonKey === `remove-${rowIdx}` ? "0 3px 6px rgba(0, 0, 0, 0.4)" : "none",
                      }}
                    >
                      <Minus size={12} strokeWidth={3} color="#ffffff" />
                    </button>
                    <button
                      type="button"
                      disabled={hasClientAnswer}
                      onClick={() => {
                        if (hasClientAnswer) return;
                        insertBlankTemplateRowBelow(rowIdx);
                      }}
                      onMouseEnter={() => setLiftedButtonKey(`add-${rowIdx}`)}
                      onMouseLeave={() => setLiftedButtonKey((prev) => (prev === `add-${rowIdx}` ? null : prev))}
                      title={hasClientAnswer ? "This row has a client-confirmed answer and can't be edited" : "Add a blank row below"}
                      className="flex h-4 w-4 items-center justify-center rounded-full transition-transform duration-150 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: hasClientAnswer ? "#9CA3AF" : "#22C55E",
                        color: "#ffffff",
                        marginRight: 5,
                        transform: !hasClientAnswer && liftedButtonKey === `add-${rowIdx}` ? "translateY(-2px)" : "none",
                        boxShadow: !hasClientAnswer && liftedButtonKey === `add-${rowIdx}` ? "0 3px 6px rgba(0, 0, 0, 0.4)" : "none",
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
            no way to drop only part of it). The HOVERABLE/DRAGGABLE hit area (this outer div) is
            flush against the row +/- strip's own left edge — touching it, zero gap — so hovering a
            row, sliding onto the +/- strip, then onto this handle never crosses a dead zone that
            would fade either one out (and hide the button) before the pointer actually reaches it.
            Only the drawn PILL inside it (border/background/icon) is inset from that shared edge by
            GROUP_DRAG_HANDLE_GAP_PX, so it reads as visually separated from the +/- buttons without
            that gap being a real dead zone for hover/grab purposes — you can grab anywhere from the
            group's own rows all the way to the pill's near edge. Never rendered at all once the
            whole sheet is locked (isSentToClient) — same reasoning as the row +/- strip above. */}
        {isProjectSheetView && !isSentToClient
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
                  className="absolute flex cursor-grab items-center justify-start transition-opacity duration-150 active:cursor-grabbing"
                  style={{
                    left: -(ADD_ROW_GUTTER_PX + GROUP_DRAG_HANDLE_GAP_PX + GROUP_DRAG_HANDLE_WIDTH_PX),
                    top: colHeaderHeightPx + rowPrefixSums[g.startRow],
                    width: GROUP_DRAG_HANDLE_WIDTH_PX + GROUP_DRAG_HANDLE_GAP_PX,
                    height: rowPrefixSums[g.endRow + 1] - rowPrefixSums[g.startRow],
                    opacity: isActive ? 1 : 0,
                    pointerEvents: isActive ? "auto" : "none",
                  }}
                >
                  <div
                    className="flex h-full items-center justify-center rounded-[6px] border"
                    style={{ width: GROUP_DRAG_HANDLE_WIDTH_PX, backgroundColor: "var(--panel-muted)", borderColor: "var(--glass-border)" }}
                  >
                    <GripVertical size={12} color="var(--text-muted)" />
                  </div>
                </div>
              );
            })
          : null}

        {/* "Import from Quote" — a small floating button, its own normal fixed size, kept entirely
            OUTSIDE the table's right edge (never overlapping the zone or any of its content),
            sitting level with the linked editable zone's own top row. Only shown while that exact
            zone is the current selection (clicked/tapped into) — not permanently floating for every
            linked zone on screen at once, which read as clutter and, on mobile, a button sitting
            half off-screen with nothing to anchor it to until you'd already found the zone some
            other way. Pops in (glass-bubble-pop) the moment a zone becomes selected, and pops away
            (the same ghost-portal pop the desktop floating action pill uses for a button leaving the
            bar) the moment it's deselected, rather than just vanishing — see FloatingSideButton's own
            comment. Shown whenever that zone has a Quote link pre-configured in the Company Settings
            template builder (right-click the zone there — see linkedQuoteSourceGrid's own comment on
            SpecsGridEditorProps for why the link itself is never editable here). */}
        {isProjectSheetView && !isSentToClient && quoteGridForLinkedPull && !fitToViewportOnMobile ? (
          <FloatingSideButton
            target={(() => {
              if (!selection) return null;
              const selectedRect = normalizeRect(selection);
              for (const g of expandedGroups) {
                const zone = g.zones?.find((z) => z.kind === "editable" && (z.linkedQuoteGroups?.length ?? 0) > 0);
                if (!zone) continue;
                const topRow = g.startRow + zone.startRow;
                const bottomRow = g.startRow + zone.endRow;
                if (selectedRect.minRow > bottomRow || selectedRect.maxRow < topRow) continue;
                const justImported = Boolean(recentlyImportedGroupIds[g.id]);
                return {
                  id: g.id,
                  leftPx: rowHeaderWidthPx + tableTotalWidthPx + 8,
                  topPx: colHeaderHeightPx + rowPrefixSums[topRow] + 6,
                  content: (
                    <button
                      type="button"
                      onClick={() => requestImportLinkedQuoteTextIntoZoneForGroup(g.id)}
                      title={`Import "${g.name}" from its editable zone's linked Quote group(s)`}
                      className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[7px] border px-2 text-[11px] font-bold shadow-sm transition hover:brightness-95"
                      style={
                        justImported
                          ? { borderColor: "var(--success-strong)", backgroundImage: "var(--success-gradient)", color: "#ffffff" }
                          : { borderColor: "var(--brand-strong)", backgroundImage: "var(--brand-gradient)", color: "#ffffff" }
                      }
                    >
                      {justImported ? <Check size={12} /> : <RefreshCw size={12} />}
                      {justImported ? "Imported" : "Import from Quote"}
                    </button>
                  ),
                };
              }
              return null;
            })()}
          />
        ) : null}

        {/* "Mark for Confirmation" — same floating-pill treatment as "Import from Quote" above
            (right down to the component), moved out of the fixed toolbar so it sits right next to
            whatever's actually selected instead of a static slot staff had to look away to find.
            Desktop only (!fitToViewportOnMobile) — mobile gets its own long-press dropdown instead,
            further down, for the same reason useLongPress's own doc comment gives for the Version
            History rows' identical desktop-hover/mobile-hold split: this is a hover-revealed-on-
            desktop interaction with no touch equivalent. Positioned level with a single cell's own
            row; for a multi-cell target, vertically CENTERED across the full span from the target's
            own first to last row (baked into topPx — see computeMarkForConfirmationTarget for the
            target selection logic itself, shared with the mobile dropdown). */}
        {isProjectSheetView && allowConfirmationMarking && !fitToViewportOnMobile ? (
          <FloatingSideButton
            target={(() => {
              const result = computeMarkForConfirmationTarget();
              if (!result) return null;
              const rows = result.allTargets.map((t) => t.row);
              const minRow = Math.min(...rows);
              const maxRow = Math.max(...rows);
              const midpointPx = (rowPrefixSums[minRow] + rowPrefixSums[maxRow + 1]) / 2;
              return {
                id: "mark-for-confirmation",
                leftPx: rowHeaderWidthPx + tableTotalWidthPx + 8,
                // Vertically CENTERS the button on the span's own midpoint — baked directly into
                // topPx (see FloatingSideButtonTarget.topPx's own comment for why this can't be a
                // CSS transform) by subtracting half this h-7 (28px) button's own height.
                topPx: colHeaderHeightPx + midpointPx - 14,
                content: (
                  <button
                    type="button"
                    onClick={result.onClick}
                    title={result.title}
                    className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[7px] border px-2 text-[11px] font-bold shadow-sm transition hover:brightness-95"
                    // Always the same green as the "Submitted Version" button (var(--success-gradient)/
                    // var(--success-strong)) regardless of isActive — that one only still drives the
                    // label text (below), not the color anymore.
                    style={{ borderColor: "var(--success-strong)", backgroundImage: "var(--success-gradient)", color: "#ffffff" }}
                  >
                    <CheckSquare size={12} />
                    {result.label}
                  </button>
                ),
              };
            })()}
          />
        ) : null}

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

        {/* The zone-marking preview's own equivalent of groupOutlines just above — a solid
            success-colored outline (rather than groupOutlines' own dashed brand-strong one) so an
            already-marked zone reads as visually distinct from an ordinary group boundary. */}
        {previewZoneOutlines.map((z) => (
          <div
            key={z.id}
            className="pointer-events-none absolute"
            style={{
              left: rowHeaderWidthPx,
              top: colHeaderHeightPx + z.top,
              width: tableTotalWidthPx,
              height: z.height,
              border: "2px dotted var(--success-strong)",
            }}
          >
            {/* Top-right, INSIDE the zone's own border (unlike groupOutlines' label above, which
                straddles the top edge from outside) — the user specifically wants this label read as
                a badge sitting inside the zone it's labeling, not as an external tag on the box. */}
            <span
              className="absolute right-1 top-1 whitespace-nowrap rounded-[4px] px-1 text-[9px] font-bold"
              style={{ backgroundColor: "var(--success-soft)", color: "var(--success-strong)" }}
            >
              {z.name}
            </span>
          </div>
        ))}

        {/* showEditableGroupBorders' own overlay — see its comment on SpecsGridEditorProps. A plain
            inset border (no label, no dashing) rather than reusing groupOutlines' own look: this is
            meant to read as a quiet, permanent part of the live document (only Quote's own project
            sheet turns it on), not as a layout-tool wireframe like the builder's version above. An
            inset box-shadow (same technique as selectionOutline just below) draws the border without
            affecting this div's own box/layout, so adjacent groups' borders never fight for space. */}
        {editableGroupOutlines.map((g) => (
          <div
            key={`editable-border-${g.id}`}
            className="pointer-events-none absolute"
            style={{
              left: rowHeaderWidthPx,
              top: colHeaderHeightPx + g.top,
              width: tableTotalWidthPx,
              height: g.height,
              boxShadow: "inset 0 0 0 1.5px var(--brand-strong)",
            }}
          />
        ))}

        {/* highlightedGroupId's own overlay — a bubble on the host page's own "Sections" list is
            being hovered (see SpecsGridEditorProps' own comment on why this is one-directional:
            the page deliberately never echoes THIS component's own internal hover back in here).
            Independent of groupOutlines/editableGroupOutlines above (a plain tinted box, not a
            label or a permanent border), since neither of those is guaranteed to be visible in
            every context this needs to work in. */}
        {groupOutlines
          .filter((g) => g.id === highlightedGroupId)
          .map((g) => (
            <div
              key={`hover-highlight-${g.id}`}
              className="pointer-events-none absolute rounded-[2px]"
              style={{
                left: rowHeaderWidthPx,
                top: colHeaderHeightPx + g.top,
                width: tableTotalWidthPx,
                height: g.height,
                backgroundColor: "rgba(37, 99, 235, 0.12)",
                boxShadow: "inset 0 0 0 2px #2563EB",
              }}
            />
          ))}

        {selectionOutline && !hideCellSelectionOutline ? (
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

        {/* Mobile-only selection-extend handles — see selectionHandleDragRef's own comment for why
            these exist at all. One per edge, centered on that edge's own midpoint, each only moving
            the ONE dimension (row range for top/bottom, column range for left/right) its own edge
            represents. A generously-sized invisible 28px touch target around a small visible dot —
            same "bigger hit area than visible mark" convention this file already uses elsewhere
            (e.g. the per-row +/- buttons) — real fingers are far less precise than a mouse cursor. */}
        {fitToViewportOnMobile && !zonePreviewMode && selectionOutline && !hideCellSelectionOutline
          ? (["top", "bottom", "left", "right"] as const).map((edge) => {
              const isVertical = edge === "top" || edge === "bottom";
              const centerX = rowHeaderWidthPx + selectionOutline.left + selectionOutline.width / 2;
              const centerY = colHeaderHeightPx + selectionOutline.top + selectionOutline.height / 2;
              const left = edge === "left" ? rowHeaderWidthPx + selectionOutline.left : edge === "right" ? rowHeaderWidthPx + selectionOutline.left + selectionOutline.width : centerX;
              const top = edge === "top" ? colHeaderHeightPx + selectionOutline.top : edge === "bottom" ? colHeaderHeightPx + selectionOutline.top + selectionOutline.height : centerY;
              const isActive = draggingSelectionHandle === edge;
              return (
                <div
                  key={edge}
                  onTouchStart={onSelectionHandleTouchStart(edge)}
                  onTouchMove={onSelectionHandleTouchMove}
                  onTouchEnd={onSelectionHandleTouchEnd}
                  onTouchCancel={onSelectionHandleTouchEnd}
                  className="absolute z-20 flex items-center justify-center"
                  style={{
                    left,
                    top,
                    width: 28,
                    height: 28,
                    transform: "translate(-50%, -50%)",
                    touchAction: "none",
                    WebkitTapHighlightColor: "transparent",
                    cursor: isVertical ? "ns-resize" : "ew-resize",
                  }}
                >
                  <div
                    className="rounded-full border-2 transition-transform"
                    style={{
                      width: isActive ? 16 : 12,
                      height: isActive ? 16 : 12,
                      backgroundColor: "var(--brand-strong)",
                      borderColor: "#ffffff",
                      boxShadow: "var(--shadow-glass)",
                    }}
                  />
                </div>
              );
            })
          : null}

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
              ref={setHeaderContextMenuNode}
              className="fixed z-[2000] w-[180px] overflow-hidden rounded-[8px] border py-1"
              style={{
                left: headerContextMenu.x,
                top: headerContextMenuTop ?? headerContextMenu.y,
                borderColor: "var(--glass-border)",
                backgroundColor: "var(--glass-bg-strong)",
                backdropFilter: "blur(24px) saturate(180%)",
                WebkitBackdropFilter: "blur(24px) saturate(180%)",
                boxShadow: "var(--shadow-glass)",
              }}
            >
              <button
                type="button"
                disabled={!selection}
                onClick={() => {
                  copySelection();
                  setHeaderContextMenu(null);
                }}
                className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12px] hover:brightness-95 disabled:opacity-40"
                style={{ color: "var(--text-main)" }}
              >
                <Copy size={13} />
                Copy
              </button>
              <button
                type="button"
                disabled={!hasClipboard || !activeCell}
                onClick={() => {
                  pasteAtSelection();
                  setHeaderContextMenu(null);
                }}
                className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12px] hover:brightness-95 disabled:opacity-40"
                style={{ color: "var(--text-main)" }}
              >
                <ClipboardPaste size={13} />
                Paste
              </button>
              <div className="my-1 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
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
                        <button
                          type="button"
                          onClick={(e) => {
                            groupModalOriginElRef.current = e.currentTarget;
                            setGroupModalOrigin(captureGlassModalOrigin(e));
                            openGroupModal(existingGroup?.id ?? null, rangeStart, rangeEnd, existingGroup);
                            setHeaderContextMenu(null);
                          }}
                          className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12px] hover:brightness-95"
                          style={{ color: "var(--text-main)" }}
                        >
                          <Link2 size={13} />
                          Group
                        </button>
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
      {shouldRenderGroupModal && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 flex items-center justify-center px-4 py-4" style={{ zIndex: 2147483647 }}>
              <button
                type="button"
                aria-label="Close group settings backdrop"
                onClick={() => setGroupModalTarget(null)}
                className="glass-modal-backdrop absolute inset-0"
              />
              <div ref={groupModalPanelRef} className="glass-modal-panel relative w-[min(880px,96vw)] overflow-hidden" style={{ zIndex: 2147483647 }}>
                <div className="glass-modal-header px-5 py-4">
                  <p className="text-[14px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                    {groupModalTarget?.groupId ? "Group Settings" : "New Group"}
                  </p>
                </div>
                <form
                  className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveGroupModal();
                  }}
                >
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
                      Group Name
                    </label>
                    <input
                      autoFocus
                      value={groupDraft.name}
                      onChange={(e) => setGroupDraft((d) => ({ ...d, name: e.target.value }))}
                      placeholder="e.g. Handle Details"
                      className="h-9 w-full rounded-[9px] border px-3 text-[13px] outline-none"
                      style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                    />
                  </div>
                  {groupsSupportPricing ? (
                    <div>
                      <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
                        Category
                      </label>
                      <p className="mb-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                        Groups sharing the same category are clustered together under one heading in the Quote Extras sidebar. Leave blank to leave this one uncategorized.
                      </p>
                      <input
                        list="specs-group-category-options"
                        value={groupDraft.category}
                        onChange={(e) => setGroupDraft((d) => ({ ...d, category: e.target.value }))}
                        placeholder="e.g. Benchtops"
                        className="h-9 w-full rounded-[9px] border px-3 text-[13px] outline-none"
                        style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                      />
                      <datalist id="specs-group-category-options">
                        {groupCategoryOptions.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </div>
                  ) : null}
                  {/* Whether a project's clone of this group starts shown or hidden — NOT gated
                      behind groupsSupportPricing (unlike Category/Anchor above, which are Quote-
                      Extras-sidebar-specific): both Quote and Specifications seed a fresh clone's
                      hidden state from this. Rules (below) are still applied on top and can
                      override whatever this produces. */}
                  <label className="flex items-center justify-between gap-2 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                    Default
                    <span className="inline-flex items-center gap-2">
                      <span style={{ color: "var(--text-muted)" }}>{groupDraft.defaultIncluded ? "On" : "Off"}</span>
                      <input
                        type="checkbox"
                        checked={groupDraft.defaultIncluded}
                        onChange={(e) => setGroupDraft((d) => ({ ...d, defaultIncluded: e.target.checked }))}
                        className="h-4 w-4"
                      />
                    </span>
                  </label>
                  {groupsSupportPricing ? (
                    <label
                      className="flex items-center justify-between gap-2 text-[12px] font-semibold"
                      style={{ color: "var(--text-main)" }}
                      title="If the content above it doesn't already fill the first page, this group (and anything after it) is pushed down to sit flush with the bottom of that page in Print/Download PDF"
                    >
                      Anchor to bottom of first page
                      <span className="inline-flex items-center gap-2">
                        <span style={{ color: "var(--text-muted)" }}>{groupDraft.anchorFirstPageBottom ? "On" : "Off"}</span>
                        <input
                          type="checkbox"
                          checked={groupDraft.anchorFirstPageBottom}
                          onChange={(e) => setGroupDraft((d) => ({ ...d, anchorFirstPageBottom: e.target.checked }))}
                          className="h-4 w-4"
                        />
                      </span>
                    </label>
                  ) : null}
                  {/* Rules — NOT gated behind groupsSupportPricing (that flag only controls the
                      pricing-specific fields above): dependency rules apply to both the Quote and
                      Specifications template builders alike. */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label className="block text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
                        Rules
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setGroupDraft((d) => ({
                            ...d,
                            rules: [...d.rules, { id: genSpecsGroupRuleId(), ifProductName: "", ifState: "on", thenState: "on" }],
                          }))
                        }
                        className="inline-flex h-7 items-center gap-1 rounded-[7px] border px-2 text-[11px] font-bold transition hover:brightness-95"
                        style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                      >
                        <Plus size={12} /> Add Rule
                      </button>
                    </div>
                    <p className="mb-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Automatically turn this group on or off based on whether a Product is selected on the project, applied the moment a project&apos;s sheet is first generated from this template.
                    </p>
                    {groupDraft.rules.length === 0 ? (
                      <p
                        className="rounded-[9px] border px-3 py-2 text-[11px]"
                        style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
                      >
                        No rules yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {groupDraft.rules.map((rule, idx) => {
                          const updateRule = (patch: Partial<SpecsGroupRule>) =>
                            setGroupDraft((d) => ({
                              ...d,
                              rules: d.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
                            }));
                          return (
                            <div
                              key={rule.id}
                              className="flex flex-wrap items-center gap-1.5 rounded-[9px] border p-2"
                              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
                            >
                              <span className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>IF</span>
                              <select
                                value={rule.ifProductName}
                                onChange={(e) => updateRule({ ifProductName: e.target.value })}
                                className="h-8 min-w-[110px] flex-1 rounded-[7px] border px-2 text-[11px]"
                                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                              >
                                <option value="">Select product…</option>
                                {(productOptions ?? []).map((name) => (
                                  <option key={name} value={name}>{name}</option>
                                ))}
                              </select>
                              <select
                                value={rule.ifState}
                                onChange={(e) => updateRule({ ifState: e.target.value as "on" | "off" })}
                                className="h-8 rounded-[7px] border px-2 text-[11px]"
                                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                              >
                                <option value="on">is On</option>
                                <option value="off">is Off</option>
                              </select>
                              <span className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>THEN this is</span>
                              <select
                                value={rule.thenState}
                                onChange={(e) => updateRule({ thenState: e.target.value as "on" | "off" })}
                                className="h-8 rounded-[7px] border px-2 text-[11px]"
                                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                              >
                                <option value="on">On</option>
                                <option value="off">Off</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => setGroupDraft((d) => ({ ...d, rules: d.rules.filter((_, i) => i !== idx) }))}
                                className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-[7px] transition hover:bg-[var(--danger-soft)]"
                                style={{ color: "var(--danger-strong)" }}
                                aria-label="Remove rule"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {companyRoleOptions && companyRoleOptions.length > 0 ? (
                    <div>
                      <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
                        Allow Editable By
                      </label>
                      <p className="mb-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                        Leave everything unchecked to allow anyone with sheet access to edit this group&apos;s rows.
                      </p>
                      <div className="max-h-[140px] space-y-1 overflow-y-auto rounded-[9px] border p-2" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
                        {companyRoleOptions.map((role) => {
                          const checked = groupDraft.editableByRoleIds.includes(role.id);
                          return (
                            <label key={role.id} className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-[12px] hover:brightness-95" style={{ color: "var(--text-main)" }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setGroupDraft((d) => ({
                                    ...d,
                                    editableByRoleIds: e.target.checked
                                      ? [...d.editableByRoleIds, role.id]
                                      : d.editableByRoleIds.filter((id) => id !== role.id),
                                  }))
                                }
                                className="h-3.5 w-3.5"
                              />
                              {role.name}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {groupsSupportPricing ? (
                    <div>
                      <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
                        Cost
                      </label>
                      <input
                        value={groupDraft.price}
                        onChange={(e) => setGroupDraft((d) => ({ ...d, price: e.target.value }))}
                        placeholder="e.g. $150.00"
                        inputMode="decimal"
                        className="h-9 w-full rounded-[9px] border px-3 text-[13px] outline-none"
                        style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                      />
                    </div>
                  ) : null}
                  {/* Not gated behind groupsSupportPricing/linkedQuoteSourceGrid — shown for any
                      group, in both the Quote and Specs template builders (and any live project
                      editor this same modal appears in), since a zone is a general group concept,
                      not a Quote-pricing or Specs-linking one. */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label className="block text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
                        Group Preview
                      </label>
                      {previewGrid ? (
                        <button
                          type="button"
                          disabled={!previewSelectedRowRange}
                          onClick={() => {
                            if (!previewSelectedRowRange) return;
                            // Replaces any existing editable zone — only one makes sense per group
                            // right now, since importLinkedQuoteTextIntoZone only ever targets the
                            // first "editable" zone it finds.
                            setGroupDraft((d) => ({
                              ...d,
                              zones: [{ id: genSpecsZoneId(), kind: "editable", startRow: previewSelectedRowRange.minRow, endRow: previewSelectedRowRange.maxRow }],
                            }));
                          }}
                          className="inline-flex h-7 items-center gap-1 rounded-[7px] border px-2 text-[11px] font-bold transition hover:brightness-95 disabled:opacity-50"
                          style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                        >
                          <Link2 size={12} />
                          Mark Selection as Editable Zone
                        </button>
                      ) : null}
                    </div>
                    <p className="mb-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Select rows below, then use the button above to mark this group&apos;s editable
                      zone. In an actual project&apos;s Quote/Specifications window, only that zone
                      stays editable — everything else in the group becomes read-only there. Here in
                      the template builder, the whole group stays freely editable either way.
                    </p>
                    {previewGrid ? (
                      <div className="overflow-auto rounded-[9px] border" style={{ maxHeight: 380, borderColor: "var(--glass-border)" }}>
                        <SpecsGridEditor
                          value={previewGrid}
                          onChange={() => {}}
                          zonePreviewMode
                          previewZones={groupDraft.zones}
                          onSelectionRangeChange={setPreviewSelectedRowRange}
                          onZoneContextMenu={(zoneId, x, y) => {
                            setExpandedQuoteGroupNamesInPicker(new Set());
                            setZoneContextMenu({ zoneId, x, y, view: "menu" });
                          }}
                        />
                      </div>
                    ) : (
                      <p
                        className="rounded-[9px] border px-3 py-2 text-[11px]"
                        style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
                      >
                        Save this group once to preview it and define zones.
                      </p>
                    )}
                    {groupDraft.zones.length > 0 ? (
                      <div className="mt-1.5 space-y-1">
                        {groupDraft.zones.map((zone) => {
                          const linkedCount = zone.linkedQuoteGroups?.length ?? 0;
                          return (
                            <div
                              key={zone.id}
                              className="flex items-center gap-1.5 rounded-[9px] border p-2"
                              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
                            >
                              <span className="flex-1 truncate text-[12px]" style={{ color: "var(--text-main)" }}>
                                Editable Zone
                                {linkedCount > 0 ? (
                                  <span style={{ color: "var(--text-muted)" }}> — {linkedCount} Quote group{linkedCount === 1 ? "" : "s"} linked (right-click it above to manage)</span>
                                ) : null}
                              </span>
                              <button
                                type="button"
                                onClick={() => setGroupDraft((d) => ({ ...d, zones: d.zones.filter((z) => z.id !== zone.id) }))}
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] transition hover:bg-[var(--danger-soft)]"
                                style={{ color: "var(--danger-strong)" }}
                                aria-label="Remove zone"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setGroupModalTarget(null)}
                      className="h-9 rounded-[9px] border px-4 text-[12px] font-bold hover:brightness-95"
                      style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="h-9 rounded-[9px] border px-4 text-[12px] font-bold text-white hover:brightness-95"
                      style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
                    >
                      Save
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
      {/* Right-click an editable zone in the Group Preview above opens this — see onZoneContextMenu's
          own comment on SpecsGridEditorProps and zoneContextMenu's own comment near its useState for
          the full two-step "menu then picker" flow. Portaled the same way headerContextMenu/the
          Group Settings modal itself already are. */}
      {zoneContextMenu && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0" style={{ zIndex: 2147483647 }}>
              <button
                type="button"
                aria-label="Close zone link menu"
                onClick={() => setZoneContextMenu(null)}
                className="absolute inset-0 cursor-default"
                style={{ background: "transparent" }}
              />
              <div
                className="glass-modal-panel absolute overflow-hidden"
                style={{
                  left: Math.min(zoneContextMenu.x, (typeof window !== "undefined" ? window.innerWidth : 1000) - 300),
                  top: zoneContextMenu.y,
                  width: zoneContextMenu.view === "menu" ? 220 : 300,
                }}
              >
                {zoneContextMenu.view === "menu" ? (
                  <button
                    type="button"
                    onClick={() => setZoneContextMenu((m) => (m ? { ...m, view: "picker" } : m))}
                    className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-[12px] hover:brightness-95"
                    style={{ color: "var(--text-main)" }}
                  >
                    <Link2 size={13} />
                    Link to Quote Groups
                  </button>
                ) : (
                  <div className="max-h-[320px] overflow-y-auto p-2">
                    <div className="mb-1.5 flex items-center justify-between px-1">
                      <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                        Link to Quote Groups
                      </span>
                      <button
                        type="button"
                        onClick={() => setZoneContextMenu(null)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] hover:bg-[var(--danger-soft)]"
                        style={{ color: "var(--text-muted)" }}
                        aria-label="Close"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    {/* Currently linked, in concatenation order — drag to reorder, same native HTML5
                        DnD convention used elsewhere in this file for a short in-modal list. */}
                    {zoneContextMenuLinkedRefs.length > 0 ? (
                      <div className="mb-1.5 space-y-1">
                        {zoneContextMenuLinkedRefs.map((ref, idx) => (
                          <div
                            key={`${ref.quoteGroupName}:${ref.source}`}
                            draggable
                            onDragStart={() => setDraggingZoneLinkIndex(idx)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const fromIdx = draggingZoneLinkIndex;
                              setDraggingZoneLinkIndex(null);
                              const targetZoneId = zoneContextMenu.zoneId;
                              if (fromIdx === null || fromIdx === idx) return;
                              setGroupDraft((d) => ({
                                ...d,
                                zones: d.zones.map((z) => {
                                  if (z.id !== targetZoneId) return z;
                                  const next = [...(z.linkedQuoteGroups ?? [])];
                                  const [moved] = next.splice(fromIdx, 1);
                                  next.splice(idx, 0, moved);
                                  return { ...z, linkedQuoteGroups: next };
                                }),
                              }));
                            }}
                            onDragEnd={() => setDraggingZoneLinkIndex(null)}
                            className="flex items-center gap-1.5 rounded-[7px] border p-1.5"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
                          >
                            <GripVertical size={12} className="shrink-0 cursor-grab" style={{ color: "var(--text-muted)" }} />
                            <span className="flex-1 truncate text-[11px]" style={{ color: "var(--text-main)" }}>
                              {ref.quoteGroupName}
                              {ref.source === "zone" ? " → Editable Zone" : ""}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleZoneLinkRef(ref.quoteGroupName, ref.source)}
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] transition hover:bg-[var(--danger-soft)]"
                              style={{ color: "var(--danger-strong)" }}
                              aria-label="Remove link"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="my-1 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
                    {/* Every linkable Quote group — clicking the name itself toggles linking the
                        WHOLE group; the chevron (only shown when that group has its own editable
                        zone) expands a second, indented choice to link just that zone instead. */}
                    {linkableQuoteGroups.length === 0 ? (
                      <p className="px-1 py-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                        No Quote groups available.
                      </p>
                    ) : (
                      linkableQuoteGroups.map((g) => {
                        const hasOwnZone = g.zones?.some((z) => z.kind === "editable");
                        const expanded = expandedQuoteGroupNamesInPicker.has(g.name);
                        const groupLinked = isRefLinked(g.name, "group");
                        const zoneLinked = isRefLinked(g.name, "zone");
                        return (
                          <div key={g.id}>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => toggleZoneLinkRef(g.name, "group")}
                                className="flex flex-1 items-center gap-1.5 truncate rounded-[6px] px-1.5 py-1 text-left text-[11px] hover:brightness-95"
                                style={{ color: groupLinked ? "var(--brand-strong)" : "var(--text-main)", fontWeight: groupLinked ? 700 : 400 }}
                              >
                                {groupLinked ? <Check size={12} className="shrink-0" /> : null}
                                <span className="truncate">{g.name}</span>
                              </button>
                              {hasOwnZone ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedQuoteGroupNamesInPicker((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(g.name)) next.delete(g.name);
                                      else next.add(g.name);
                                      return next;
                                    })
                                  }
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] hover:brightness-95"
                                  style={{ color: "var(--text-muted)" }}
                                  aria-label="Show this group's own editable zone"
                                >
                                  <ChevronDown size={13} style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform 140ms ease" }} />
                                </button>
                              ) : null}
                            </div>
                            {expanded ? (
                              <button
                                type="button"
                                onClick={() => toggleZoneLinkRef(g.name, "zone")}
                                className="ml-4 flex items-center gap-1.5 truncate rounded-[6px] px-1.5 py-1 text-left text-[11px] hover:brightness-95"
                                style={{ color: zoneLinked ? "var(--brand-strong)" : "var(--text-main)", fontWeight: zoneLinked ? 700 : 400 }}
                              >
                                {zoneLinked ? <Check size={12} className="shrink-0" /> : null}
                                <span className="truncate">↳ Editable Zone</span>
                              </button>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
      {/* "Replace Zone Content?" — gates requestImportLinkedQuoteTextIntoZoneForGroup's own confirm
          path (see its comment): only shown when the zone's current text doesn't match what was
          last imported into it, i.e. it's been hand-edited (or hand-typed in the first place) since.
          A zone that's still empty, or whose text exactly matches the last import, skips this
          entirely and imports straight away — see that function. */}
      {pendingImportGroupId && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 flex items-center justify-center px-4 py-4" style={{ zIndex: 2147483647 }}>
              <button
                type="button"
                aria-label="Close replace zone content confirmation backdrop"
                onClick={() => setPendingImportGroupId(null)}
                className="glass-modal-backdrop absolute inset-0"
              />
              <div className="glass-modal-panel relative w-[min(420px,96vw)] overflow-hidden" style={{ zIndex: 2147483647 }}>
                <div className="glass-modal-header px-5 py-4">
                  <p className="text-[14px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                    Replace Zone Content?
                  </p>
                </div>
                <div className="space-y-4 px-5 py-4">
                  <p className="text-[12px]" style={{ color: "var(--text-main)" }}>
                    This zone&apos;s text doesn&apos;t match the last import — it looks like it&apos;s been edited since. Importing now will
                    replace the entire thing with the linked Quote group&apos;s current text. (Ctrl+Z afterward will undo it.)
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setPendingImportGroupId(null)}
                      className="h-9 rounded-[9px] border px-4 text-[12px] font-bold hover:brightness-95"
                      style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const groupId = pendingImportGroupId;
                        setPendingImportGroupId(null);
                        if (groupId) importLinkedQuoteTextIntoZoneForGroup(groupId);
                      }}
                      className="h-9 rounded-[9px] border px-4 text-[12px] font-bold hover:brightness-95"
                      style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
                    >
                      Replace
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {/* Mobile's own long-press dropdowns for "Mark for Confirmation" and "Import from Quote" — see
          useMobileCellLongPressMenu/MobileLongPressMenu's own comments for the shared gesture and
          rendering mechanics. Import is rendered after Confirm only so its z-stack wins on the rare
          cell eligible for both (matches makeHandlers' own priority at the handler-spread above). */}
      <MobileLongPressMenu
        menu={mobileConfirmLongPress.menu}
        menuClosing={mobileConfirmLongPress.menuClosing}
        menuRef={mobileConfirmLongPress.menuRef}
        color="var(--success-strong)"
        icon={<CheckSquare size={16} />}
      />
      <MobileLongPressMenu
        menu={mobileImportLongPress.menu}
        menuClosing={mobileImportLongPress.menuClosing}
        menuRef={mobileImportLongPress.menuRef}
        color="var(--brand-strong)"
        icon={<RefreshCw size={16} />}
      />
    </div>
  );
}

// Only re-syncs its DOM content from `runs` when it doesn't currently hold real focus — a
// contentEditable div whose children are re-driven on every keystroke fights the browser's own
// cursor position (a well-known React+contentEditable problem). Plain-text edits commit on blur
// (clicking away), not per keystroke; a bold/underline change commits immediately instead (see
// onCommitRuns' own comment), since applying one doesn't blur the cell.
function SpecsCellTextArea({
  runs,
  style,
  isFocused,
  onFocusCell,
  onBlurCommitRuns,
  onLiveCommitRuns,
  onToggleWholeCellFormat,
  onNaturalHeightChange,
  remeasureSignal,
  readOnly,
  readOnlyReason,
  dimmed = true,
}: {
  cellKey: string;
  runs: SpecsTextRun[];
  style: SpecsCellStyle;
  isFocused: boolean;
  onFocusCell: () => void;
  onBlurCommitRuns: (runs: SpecsTextRun[]) => void;
  // Fired right after a Ctrl+B/Ctrl+U (or the toolbar, via applyFormatCommand) formats a highlighted
  // selection inside this same cell — that never blurs it, so without a separate commit path here the
  // change would only get saved if the user happened to click away afterward.
  onLiveCommitRuns: (runs: SpecsTextRun[]) => void;
  // Ctrl+B/Ctrl+U with nothing highlighted — "entire cell controls all of the text within it".
  onToggleWholeCellFormat: (key: "bold" | "underline") => void;
  // Reports this cell's own natural (unclipped) content height in px — via `scrollHeight`, which
  // always reflects the div's real content size regardless of the parent wrapper's own overflow:hidden
  // clipping — every time it might have changed: on every keystroke while typing, and once whenever
  // the committed `runs` (re)sync in from outside. The parent grows the row to fit whenever this
  // exceeds its current height (never shrinks it back down on its own).
  onNaturalHeightChange?: (px: number) => void;
  // The caller combines two separate things that can each make this cell's very first scrollHeight
  // measurement too short, with nothing to ever correct it afterward since onNaturalHeightChange
  // only ever GROWS a row, never shrinks it: fitToViewportOnMobile's own mockPageBoxWidthPx, which
  // — like sheetFitScale itself (see its own comment) — can still be settling one render after
  // this cell first mounts, wide enough to let text that will end up wrapping onto more lines
  // measure short on that very first pass; and fontsReadyTick, for a custom @font-face whose
  // font-display: swap renders a fallback font (different metrics, different wrapping) until the
  // real one finishes loading (see its own comment — same risk lib/specs-grid-pdf.ts already works
  // around for PDF export). Either way the row (and the border/group overlay computed from that
  // same stuck height) stops matching how much room the text actually needs, worst for multi-
  // paragraph cells with the most lines to under-count. Included in the measuring effect's own
  // deps below purely so either one changing re-runs it — its actual value is never read.
  remeasureSignal?: number;
  // True when the current viewer's role isn't in this cell's group's editableByRoleIds (see
  // SpecsGridEditorProps.canEditSpecsGroup's own comment) OR when it's a blank cell outside any
  // group with lockUngroupedBlankCells on (see that prop's own comment) — either way, renders the
  // text normally, just not editable: no contentEditable, no focus/format handlers to short-circuit.
  readOnly?: boolean;
  // Shown as the read-only div's title tooltip — defaults to the permission-based message, since
  // that's readOnly's only reason historically; pass this when readOnly is true for a DIFFERENT
  // reason (e.g. lockUngroupedBlankCells), so the tooltip doesn't claim a permissions issue that
  // isn't the actual cause.
  readOnlyReason?: string;
  // Defaults true (the existing washed-out look for a permission/structural lock). Pass false for
  // a lock that isn't a restriction on THIS viewer — e.g. isSentToClient — where the text should
  // read exactly as it will to the client, in full black, not grey.
  dimmed?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isFocused) return;
    const html = runsToHtml(runs);
    if (ref.current && ref.current.innerHTML !== html) {
      ref.current.innerHTML = html;
    }
    if (ref.current) onNaturalHeightChange?.(ref.current.scrollHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, isFocused, remeasureSignal]);

  if (readOnly) {
    return (
      <div
        dangerouslySetInnerHTML={{ __html: runsToHtml(runs) }}
        title={readOnlyReason ?? "You don't have permission to edit this section"}
        className={`whitespace-pre-wrap break-words px-2 py-0.5 ${dimmed ? "opacity-80" : ""}`}
        style={{
          fontFamily: style.fontFamily || "inherit",
          fontSize: `${style.fontSize ?? DEFAULT_CELL_FONT_SIZE_PX}px`,
          textAlign: style.align ?? "left",
          color: dimmed ? style.textColor ?? "var(--text-main)" : style.textColor ?? "#000000",
          // "not-allowed" (a permissions-style cross) only reads correctly for the role-based lock —
          // a blank cell outside any group isn't being denied permission, it's just structurally
          // uninteractive, so it gets the plain pointer/default cursor instead (readOnlyReason is
          // only ever set for that second case — see its own comment).
          cursor: readOnlyReason ? "default" : "not-allowed",
        }}
      />
    );
  }

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onFocus={onFocusCell}
      onBlur={(e) => onBlurCommitRuns(parseHtmlToRuns(e.currentTarget.innerHTML))}
      onKeyDown={(e) => {
        // Enter always forces a plain <br> rather than letting the browser wrap the next line in its
        // own block element (a <div> in Chrome, sometimes different elsewhere) — parseHtmlToRuns only
        // has to understand <br>/<b>/<u> this way, not reverse-engineer whatever inconsistent
        // paragraph-wrapping shape a given browser happened to produce. Still exits/leaves the cell on
        // blur only (clicking away), same as before — no keyboard shortcut is needed or wired for that.
        if (e.key === "Enter") {
          e.preventDefault();
          document.execCommand("insertLineBreak");
          return;
        }
        const key = e.key.toLowerCase();
        if (((e.ctrlKey || e.metaKey) && key === "b") || ((e.ctrlKey || e.metaKey) && key === "u")) {
          e.preventDefault();
          const formatKey = key === "b" ? "bold" : "underline";
          // Same "highlighted -> just that part, nothing highlighted -> the whole cell" rule the
          // toolbar buttons use (applyFormatCommand) — this is the in-cell keyboard equivalent of it.
          if (ref.current && applyFormatCommandToSelection(ref.current, formatKey)) {
            onLiveCommitRuns(parseHtmlToRuns(ref.current.innerHTML));
          } else {
            onToggleWholeCellFormat(formatKey);
          }
        }
      }}
      // Pasted content (from Word/Excel/a web page) carries its own formatting as real HTML — forcing
      // plain text at paste time means it's never silently richer than what getCellRuns/parseHtmlToRuns
      // actually understand; select the pasted text afterward and use Bold/Underline if you want it
      // formatted.
      onPaste={(e) => {
        e.preventDefault();
        const plain = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, plain);
      }}
      // Reports natural height live, on every keystroke, so a row grows the moment typed text
      // actually wraps past the cell's current height — not just once you click away. `scrollHeight`
      // is layout-only (unlike getBoundingClientRect), so it's unaffected by the page's own scroll
      // position — safe to read on every input without reintroducing the scroll-offset drift this
      // file's overlay math deliberately avoids elsewhere.
      onInput={(e) => onNaturalHeightChange?.(e.currentTarget.scrollHeight)}
      // This div's own height is left fully natural (no fixed height/overflow of its own) — the
      // PARENT wrapper (in the parent render) owns vertically aligning it within the cell (see its own
      // comment for why capping a table-cell's block child with maxHeight alone doesn't reliably work
      // in Chrome) and, for a single-row cell, grows to match whatever height this div actually needs
      // (see onNaturalHeightChange above) rather than clipping it.
      className="whitespace-pre-wrap break-words px-2 py-0.5 outline-none"
      style={{
        fontFamily: style.fontFamily || "inherit",
        fontSize: `${style.fontSize ?? DEFAULT_CELL_FONT_SIZE_PX}px`,
        textAlign: style.align ?? "left",
        color: style.textColor ?? "var(--text-main)",
      }}
    />
  );
}

