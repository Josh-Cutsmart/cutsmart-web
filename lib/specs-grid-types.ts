import { interpolateQuoteTemplateText } from "@/lib/quote-template-placeholders";

export type SpecsCellStyle = {
  bold?: boolean;
  underline?: boolean;
  // A CSS font-family value, e.g. `"\"Signature\", cursive"` or `"Georgia"` — see
  // lib/quote-font-options.ts's SYSTEM_QUOTE_FONT_OPTIONS for the toolbar's own list (values there
  // are already in this exact CSS-ready form). Whole-cell, same as fontSize/align below — not
  // per-run like bold/underline, since a font picker mid-sentence is a rare enough need not to be
  // worth the same complexity.
  fontFamily?: string;
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

// A run of text sharing one formatting state — what makes "some bold, some not, in the same cell"
// possible. `text` can itself contain literal `\n` characters (a line break the user typed doesn't
// end a run by itself). See getCellRuns' own comment for how this coexists with the older, simpler
// whole-cell `SpecsCellStyle.bold`/`underline` flags on cells that predate this or were never
// touched by the rich-text editing path.
export type SpecsTextRun = {
  text: string;
  bold?: boolean;
  underline?: boolean;
};

export type SpecsCell = {
  text: string;
  // Authoritative for rendering/PDF export once present — `text` above is kept in sync as its plain
  // (formatting-stripped) concatenation purely so every OTHER reader that only ever needed plain text
  // (placeholder search/replace, the empty-row check, row pruning) keeps working unchanged. Absent on
  // a cell that has never been touched by the rich-text editor, or that was last committed as
  // uniformly one style — see getCellRuns, which synthesizes an equivalent single run from `text` +
  // the legacy `style.bold`/`style.underline` flags for exactly that case, so every reader can just
  // call getCellRuns(cell) and never need to check which representation a given cell happens to use.
  runs?: SpecsTextRun[];
  colSpan?: number;
  rowSpan?: number;
  style?: SpecsCellStyle;
  // When set, the cell renders this image (e.g. the company logo) scaled to fit the cell's full
  // width/height instead of its text — the underlying `text` is kept untouched so removing the
  // image restores whatever text was there before.
  imageUrl?: string;
  // Set via a LIVE PROJECT'S OWN "Mark for Confirmation" floating button (specs-grid-editor.tsx) —
  // marks this cell as one the external client-confirmation flow (app/client/hub/[shareId]) should
  // render as a Yes/No toggle instead of (alongside) its plain text THIS round. See
  // salesPayload.specsConfirmationSubmittedAt (app/(app)/projects/[projectId]/page.tsx) for the
  // sheet-wide lock these per-cell answers freeze under once the client submits — deliberately NOT
  // a field on SpecsGrid itself, see that type's own comment for why. Staff can only turn this on
  // for a cell where confirmableAllowed (below) is already true — see that field's own comment for
  // why the two are separate.
  confirmable?: boolean;
  // Set via the COMPANY SETTINGS TEMPLATE BUILDER's own "Mark Confirmable" toolbar button — purely
  // an ELIGIBILITY flag, not an active question. Marking a cell confirmableAllowed in the template
  // does NOT, by itself, turn it into a live Yes/No question the moment a project is cloned from
  // that template (that would mean every new project starts with questions staff never actually
  // chose to ask this round) — it only makes the cell a candidate staff CAN then activate, per
  // project, per round, via that project's own "Mark for Confirmation" button (which only shows up
  // at all for a cell where this is true — see that button's own target-computation comment in
  // specs-grid-editor.tsx). Carries through template cloning and row duplication like any other
  // cell trait; unlike `confirmable`/`confirmedYes`/`confirmedAt`, clearAllConfirmableMarks (sending
  // to a client) never touches this — eligibility is permanent, only THIS ROUND's active questions
  // reset.
  confirmableAllowed?: boolean;
  // Absent = unanswered. Freely overwritable by the client on every visit until the sheet is
  // submitted — never written by the internal editor itself, only by the public answer route.
  confirmedYes?: boolean;
  // ISO timestamp of the most recent answer write.
  confirmedAt?: string;
};

// Cell objects without their own .runs (any cell never touched by rich-text editing — plain text
// is the common case) used to fall through to a freshly-built array+object literal on EVERY call,
// even when nothing about the cell had changed. The live editor passes this straight through as a
// prop (SpecsCellTextArea's `runs`), whose own measuring effect depends on it by reference — a
// fresh array every render re-fired that effect for every plain-text cell on every single render of
// the whole grid, regardless of whether anything actually changed, which could cascade into a real
// infinite render loop the moment any one cell's grow/shrink didn't converge in a single pass (see
// growRowForCellHeight's own comment). Cached per cell object here instead: the SAME cell reference
// now always gets back the SAME runs array, and a cell only ever gets a new object reference when
// its own row is actually rebuilt by an edit — exactly when a fresh computation is wanted anyway.
const fallbackRunsCache = new WeakMap<SpecsCell, SpecsTextRun[]>();

// The one canonical way to read "the runs for this cell" — every renderer (on-screen editor, PDF
// export) should go through this rather than branching on whether `runs` happens to be populated.
export function getCellRuns(cell: SpecsCell): SpecsTextRun[] {
  if (cell.runs && cell.runs.length > 0) return cell.runs;
  const cached = fallbackRunsCache.get(cell);
  if (cached) return cached;
  const style = cell.style ?? {};
  const computed = [{ text: cell.text, ...(style.bold ? { bold: true as const } : {}), ...(style.underline ? { underline: true as const } : {}) }];
  fallbackRunsCache.set(cell, computed);
  return computed;
}

export function runsToPlainText(runs: SpecsTextRun[]): string {
  return runs.map((r) => r.text).join("");
}

// Merges adjacent runs that ended up sharing the same bold/underline state (routine after DOM-based
// rich-text edits, which can otherwise produce many redundant same-styled fragments) and drops
// genuinely empty ones — keeps the stored array from growing without bound across repeated edits.
// Never returns an empty array: a cell with no text at all still gets one empty run, matching what
// getCellRuns would have synthesized anyway, so callers never need a separate empty-cell case.
export function normalizeTextRuns(runs: SpecsTextRun[]): SpecsTextRun[] {
  const merged: SpecsTextRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const prev = merged[merged.length - 1];
    if (prev && Boolean(prev.bold) === Boolean(run.bold) && Boolean(prev.underline) === Boolean(run.underline)) {
      prev.text += run.text;
    } else {
      merged.push({ text: run.text, ...(run.bold ? { bold: true } : {}), ...(run.underline ? { underline: true } : {}) });
    }
  }
  return merged.length > 0 ? merged : [{ text: "" }];
}

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
  // The next two fields are only ever meaningful for the Quote grid (see components/
  // specs-grid-editor.tsx's `groupsSupportPricing` prop) — left undefined everywhere else,
  // including every existing Specifications grid, so this is a fully backward-compatible addition.
  // A priced group doubles as a toggleable "Quote Extra": `getExpandedRowGroups(grid).filter(g =>
  // g.price)` IS the project's quote-extras list, and `hidden` on that same group IS its per-project
  // included/excluded state — there is no separate extras list to keep in sync.
  price?: string; // currency-formatted string, e.g. "$150.00" — parsed the same way SalesQuoteExtraRow.price already is
  defaultIncluded?: boolean; // whether a brand-new project starts with this group's rows shown (hidden: false)
  // PDF/print only (see buildSpecsGridPdfBlob's own comment on anchorFirstPageBottomStartRow) — has
  // no effect on the live on-screen editor, which never paginates. When the content preceding this
  // group doesn't already fill the first physical page, its rows (and everything after it) are
  // pushed down to end flush with the bottom of that page instead of sitting wherever they'd
  // naturally fall right after the preceding content; if the first page is already full, this is a
  // no-op and the group just overflows onto the next page like anything else would.
  anchorFirstPageBottom?: boolean;
  // Company role ids (RoleRow.id from lib/company-roles.ts) allowed to edit this group's own rows in
  // a PROJECT's live Quote/Specifications window — absent/empty means unrestricted (everyone with
  // edit access to the sheet at all can edit these rows), matching every group before this field
  // existed. Enforced by the HOST page (see app/(app)/projects/[projectId]/page.tsx's own
  // canEditSpecsGroup), never by this shared type/component — a company's owner/admin always bypass
  // it there regardless of what's listed here, so a misconfigured list can't lock out the account
  // itself. Meaningless in the company-settings template builder, where there's no "current viewer"
  // to restrict — it only does anything once cloned into a real project.
  editableByRoleIds?: string[];
  // Free-text label used purely to CLUSTER groups together in the Quote Extras sidebar (see
  // app/(app)/projects/[projectId]/page.tsx's liveQuoteGridExtras/displayedQuoteGridExtras) — several
  // groups sharing the exact same category string (case-insensitively) render under one heading
  // there, in whatever order they appear in the sheet. Purely cosmetic/organizational: it has no
  // effect on hidden/pricing/anchoring behavior, and an absent category just means "uncategorized".
  category?: string;
  // Dependency rules — see applyGroupRules below. Evaluated once, only when a project's Quote/
  // Specs grid is first cloned from the company's template (or reset back to it), NOT on every
  // later live group toggle in a project.
  rules?: SpecsGroupRule[];
  // Named sub-regions within this group's own row range — for now the only kind is "editable" (see
  // SpecsGroupZoneKind), which restricts live editing to ONLY that zone's rows; the rest of the
  // group locks, even for someone who could otherwise edit it (see isRowWithinGroupZone and
  // isCellTextEditableHere in specs-grid-editor.tsx). That restriction only ever applies in a live
  // project's actual Quote/Specifications window — the Company Settings template builder (where
  // zones are authored/linked in the first place, via the Group Settings modal's own embedded
  // preview) always keeps the whole group freely editable, zones or not. A group with no zones
  // behaves exactly as before this field existed — zones are opt-in per group, not a new restriction
  // on every group. Marked by selecting rows in the preview, then the "Mark Selection as Editable
  // Zone" button above it. Row range is relative to THIS group's own startRow (0 = the group's own
  // first row), not the grid's absolute indices, so a zone never needs to move if the group itself is
  // later moved elsewhere in the sheet.
  zones?: SpecsGroupZone[];
};

export type SpecsGroupZoneKind = "editable";

export type SpecsGroupZone = {
  id: string;
  kind: SpecsGroupZoneKind;
  startRow: number;
  endRow: number;
  // Quote groups this ZONE (not the whole group it lives in) pulls combined text from — configured
  // by right-clicking the zone in the Group Settings modal's own preview, not a group-level field
  // anymore: the import only ever writes into a zone, so the link belongs on the zone itself. See
  // importLinkedQuoteTextIntoZone for how this is actually used. Strictly one-way: editing the
  // zone's content never writes anything back to Quote.
  linkedQuoteGroups?: LinkedQuoteGroupRef[];
};

export type LinkedQuoteGroupRef = {
  // Matched by NAME, deliberately not by id: resolveSpecsGridTokens regenerates every group's id on
  // every template clone (a brand-new project, or an existing project's own "Reset to Template"), so
  // an id captured in the template would already be stale the moment the very first project was
  // created from it — there's no stable id a template-level reference could even point at. A group's
  // NAME survives a clone untouched, and is the same thing an actual person picks it by in the
  // link-editor UI. A referenced name with no match in the Quote grid currently being imported from
  // (renamed, deleted, or just not created yet) is silently skipped at import time, the same way a
  // dangling SpecsGroupRule.ifProductName is already handled above; a duplicate name matches
  // whichever same-named Quote group comes first.
  quoteGroupName: string;
  // "group" pulls every real cell's text from across the Quote group's ENTIRE row range (its
  // original, and still default, behavior). "zone" pulls text ONLY from that QUOTE group's OWN
  // "editable" zone, if it has one — lets a Quote group carry fixed/boilerplate rows alongside a
  // free-text area, and have Specs pull just the free-text part rather than everything. If "zone" is
  // chosen but that Quote group turns out to have no editable zone of its own, this reference
  // contributes nothing (silently skipped, same as a name with no match at all) rather than quietly
  // falling back to the whole group — a misconfiguration should read as "nothing came through", not
  // as an unexplained wrong result.
  source: "group" | "zone";
};

// "IF this Sales Product (by name — see Company Settings > Sales > PRODUCT) is selected/not
// selected on the project (the project's own "Product" checklist), turn this group on/off" — a
// company-configured dependency between a Quote/Specs group and one of the company's Sales
// Products. "On" for a group means not hidden; "on" for a product means selected/checked on the
// project. See applyGroupRules for evaluation and the Group Settings modal's "Rules" section in
// components/specs-grid-editor.tsx for where these are authored.
export type SpecsGroupRule = {
  id: string;
  ifProductName: string;
  ifState: "on" | "off";
  thenState: "on" | "off";
};

// Applies every group's own `rules` against the project's current set of selected Sales Product
// names — each rule checks whether its referenced product is selected and, if its condition
// matches, sets this group's hidden state accordingly. A rule whose ifProductName is blank, or
// doesn't match any product, simply never matches. Matching is trimmed/case-insensitive. Multiple
// rules on the same group apply in order, last-match-wins.
export function applyGroupRules(groups: SpecsRowGroup[], selectedProductNames: string[]): SpecsRowGroup[] {
  const selected = new Set(selectedProductNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  return groups.map((group) => {
    if (!group.rules || group.rules.length === 0) return group;
    let hidden = Boolean(group.hidden);
    for (const rule of group.rules) {
      const productName = rule.ifProductName.trim().toLowerCase();
      if (!productName) continue;
      const productIsOn = selected.has(productName);
      const conditionMatches = rule.ifState === "on" ? productIsOn : !productIsOn;
      if (conditionMatches) hidden = rule.thenState === "off";
    }
    return hidden === group.hidden ? group : { ...group, hidden };
  });
}

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
  // Deliberately NOT a place for the client-confirmation sheet-wide submission lock (see
  // salesPayload.specsConfirmationSubmittedAt / app/api/specs-share/[shareId]/submit) — several
  // structural helpers in this file (insertRow, removeRow, insertColumn, removeColumn,
  // mergeSelection, unmergeCell, moveRowGroup...) and a few local ones in
  // components/specs-grid-editor.tsx reconstruct a SpecsGrid object field-by-field rather than
  // spreading the original, so any field added directly here would be silently dropped the
  // moment someone inserts a row, merges cells, or does any other structural edit. The
  // submission lock lives one level up instead, as a sibling of specificationsGrid on
  // salesPayload — outside every one of those reconstructions.
};

export type SpecsGridSelection = {
  anchorRow: number;
  anchorCol: number;
  focusRow: number;
  focusCol: number;
};

export const DEFAULT_COL_WIDTH_PX = 120;
export const TARGET_STARTING_COL_WIDTH_PX = 50;
export const DEFAULT_ROW_HEIGHT_PX = 20;
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

// The actual rendered width of the sheet's own "mock page" — the physical paper size, unless the
// grid's own columns (plus print margin) already need more room than that, in which case the box
// grows to fit them rather than clipping. Shared by components/specs-grid-client-view.tsx's own
// mock-page container and app/client/hub/[shareId]/page.tsx (so the "Submit" bars above/below the
// sheet can be sized to match it exactly, rather than guessing at a fixed width) — one calculation,
// not two copies that could drift apart.
export function computeSpecsPageBoxWidthPx(grid: SpecsGrid): number {
  const safeColumnWidths = grid.columnWidths.map((w) => (typeof w === "number" && Number.isFinite(w) && w > 0 ? w : DEFAULT_COL_WIDTH_PX));
  const tableTotalWidthPx = safeColumnWidths.reduce((sum, w) => sum + w, 0);
  const marginPx = Math.round(SPECS_PAGE_MARGIN_MM * MM_TO_PX);
  const pageWidthPx = Math.round(SPECS_PAGE_SIZES[grid.pageSize].widthMm * MM_TO_PX);
  return Math.max(pageWidthPx, tableTotalWidthPx + marginPx * 2);
}

export function genSpecsRowId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function genSpecsGroupId(): string {
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function genSpecsGroupRuleId(): string {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function genSpecsZoneId(): string {
  return `zone_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
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

// Finds whichever cell actually occupies (row, col) visually — the cell stored directly there, or
// (if that position is null, i.e. covered by an earlier anchor's colSpan) the anchor reached by
// scanning backward within the same row. A plain index lookup at a covered position returns null,
// which silently hides a wide merged cell from a neighboring row's own border-sharing checks —
// exactly why a merged cell's border used to look cut off after its first column. Doesn't chase
// rowSpan coverage reaching down from an earlier row — narrower than a full grid search, but covers
// the common horizontal-merge case these neighbor lookups need.
//
// Shared by components/specs-grid-editor.tsx's own border overlay and
// components/specs-grid-client-view.tsx's read-only render of the same grid for the public
// client-confirmation page — both need the EXACT same border geometry so a confirmable cell's
// border/spacing looks identical whether staff or the client is looking at it.
export function findRowAnchorCell(row: SpecsRow | undefined, col: number): SpecsCell | null {
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
export function resolveBorderSide(
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
export type BorderSegment = { left: number; top: number; width: number; height: number; color: string };

// rowBottoms is normally the exact same array as rowTops — they only ever differ once the live
// on-screen anchor-to-bottom shift is active (see the editor's own comment on that), where the row
// right before the spacer needs its OWN natural bottom edge here, not the anchor row's inflated top.
export function computeBorderSegments(
  grid: SpecsGrid,
  colPrefixSums: number[],
  rowTops: number[],
  rowBottoms: number[],
  hiddenRowIndexes: Set<number>,
): BorderSegment[] {
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
      const bottom = rowBottoms[Math.min(r + rowSpan, maxRowIdx)];

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
      const mineBottomOn = Boolean(ownRowVisible && style.borderBottom);
      const neighborTopOn = Boolean(belowNeighborVisible && belowNeighbor?.style?.borderTop);
      const bottomResolved = resolveBorderSide(
        mineBottomOn,
        style.borderColor,
        style.borderWidthPx,
        neighborTopOn,
        belowNeighbor?.style?.borderColor,
        belowNeighbor?.style?.borderWidthPx,
      );
      if (bottomResolved) {
        // Which edge this boundary actually belongs to matters once rowTops/rowBottoms can differ
        // (see their own comment) — a border satisfied by THIS row's own borderBottom is this row's
        // own decoration and wants its natural (non-stretching) bottom edge, but one satisfied ONLY
        // by the row BELOW's own borderTop (mineBottomOn false here) is really THAT row's own top
        // edge — e.g. an anchored row's own top border — and needs ITS top position instead, which
        // is what actually tracks the anchor shift. Falls back to `bottom` when neither/both are set
        // (resolveBorderSide already prefers "mine" there, so this matches that same preference).
        const edgeAtBottom = mineBottomOn || !neighborTopOn ? bottom : rowTops[Math.min(r + rowSpan, maxRowIdx)];
        // When every row before this one has collapsed to zero height (this cell's own row is
        // hidden and sits right at the start of the table), the resolved edge can land smaller than
        // the border's own width, pushing `top` negative — off the top edge of the scrollable area
        // and therefore invisible even though the border is otherwise correctly meant to show here
        // (as the resumed visible content's own leading edge). Clamp to 0 so it still renders, flush
        // against the table's actual top.
        segments.push({ left, top: Math.max(0, edgeAtBottom - bottomResolved.width), width: right - left, height: bottomResolved.width, color: bottomResolved.color });
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
      // A malformed `runs` entry (wrong shape, or from some unrelated future format) would otherwise
      // crash rendering the moment getCellRuns() hands it to a `.map` expecting real SpecsTextRun
      // objects — dropped here rather than rejecting the whole grid over one cell, same leniency as
      // groups/deletedGroups below. getCellRuns already synthesizes an equivalent run from plain
      // `text` for any cell that ends up without one.
      const validRuns = Array.isArray(cell.runs)
        ? cell.runs.filter((r): r is SpecsTextRun => Boolean(r) && typeof r === "object" && typeof (r as Record<string, unknown>).text === "string")
        : null;
      const sanitizedRuns = validRuns && validRuns.length > 0 ? validRuns : undefined;
      const confirmable = typeof cell.confirmable === "boolean" ? cell.confirmable : undefined;
      const confirmableAllowed = typeof cell.confirmableAllowed === "boolean" ? cell.confirmableAllowed : undefined;
      const confirmedYes = typeof cell.confirmedYes === "boolean" ? cell.confirmedYes : undefined;
      const confirmedAt = typeof cell.confirmedAt === "string" && cell.confirmedAt ? cell.confirmedAt : undefined;
      if (
        clampedRowSpan !== cell.rowSpan ||
        clampedColSpan !== cell.colSpan ||
        sanitizedRuns !== cell.runs ||
        confirmable !== cell.confirmable ||
        confirmableAllowed !== cell.confirmableAllowed ||
        confirmedYes !== cell.confirmedYes ||
        confirmedAt !== cell.confirmedAt
      ) {
        // Firestore's setDoc rejects a literal `undefined` property value outright — every optional
        // field here (including rowSpan/colSpan, absent on any cell that was never part of a merge)
        // has to be an absent key when there's nothing valid to keep, not a present key holding
        // `undefined`, so this is built field-by-field rather than `{ ...cell, runs: undefined }`.
        normalizedCells.push({
          text: cell.text,
          ...(typeof clampedRowSpan === "number" ? { rowSpan: clampedRowSpan } : {}),
          ...(typeof clampedColSpan === "number" ? { colSpan: clampedColSpan } : {}),
          ...(cell.style ? { style: cell.style } : {}),
          ...(cell.imageUrl ? { imageUrl: cell.imageUrl } : {}),
          ...(sanitizedRuns ? { runs: sanitizedRuns } : {}),
          ...(typeof confirmable === "boolean" ? { confirmable } : {}),
          ...(typeof confirmableAllowed === "boolean" ? { confirmableAllowed } : {}),
          ...(typeof confirmedYes === "boolean" ? { confirmedYes } : {}),
          ...(confirmedAt ? { confirmedAt } : {}),
        });
      } else {
        normalizedCells.push(cell);
      }
    }
    normalizedRows.push({ id: row.id, heightPx: row.heightPx, cells: normalizedCells });
  }
  const pageSize =
    typeof candidate.pageSize === "string" && candidate.pageSize in SPECS_PAGE_SIZES
      ? (candidate.pageSize as SpecsPageSize)
      : "A4";
  // Groups are a nice-to-have, not structural — a malformed entry is just dropped rather than
  // rejecting an otherwise-valid grid over it. Rebuilt field-by-field (not passed through as the raw
  // object) so a group that picked up a literal `price: undefined`/`defaultIncluded: undefined` from
  // some earlier bug — an in-memory-only state, since Firestore itself never stores `undefined` — gets
  // silently healed the next time this grid loads, rather than that stray key riding along forever
  // and failing every future save regardless of what was actually edited.
  const rawGroups = Array.isArray(candidate.groups) ? candidate.groups : [];
  const groups: SpecsRowGroup[] = [];
  for (const g of rawGroups) {
    if (!g || typeof g !== "object") continue;
    const group = g as Record<string, unknown>;
    if (
      typeof group.id !== "string" ||
      typeof group.name !== "string" ||
      typeof group.startRow !== "number" || !Number.isFinite(group.startRow) ||
      typeof group.endRow !== "number" || !Number.isFinite(group.endRow)
    ) {
      continue;
    }
    groups.push({
      id: group.id,
      name: group.name,
      startRow: group.startRow,
      endRow: group.endRow,
      ...(typeof group.hidden === "boolean" ? { hidden: group.hidden } : {}),
      ...(typeof group.price === "string" && group.price ? { price: group.price } : {}),
      ...(typeof group.defaultIncluded === "boolean" ? { defaultIncluded: group.defaultIncluded } : {}),
      ...(typeof group.anchorFirstPageBottom === "boolean" ? { anchorFirstPageBottom: group.anchorFirstPageBottom } : {}),
      ...(Array.isArray(group.editableByRoleIds)
        ? { editableByRoleIds: group.editableByRoleIds.filter((id): id is string => typeof id === "string" && id.length > 0) }
        : {}),
      ...(typeof group.category === "string" && group.category ? { category: group.category } : {}),
      ...(Array.isArray(group.rules)
        ? {
            rules: group.rules.filter((r): r is SpecsGroupRule => {
              if (!r || typeof r !== "object") return false;
              const rule = r as Record<string, unknown>;
              return (
                typeof rule.id === "string" &&
                typeof rule.ifProductName === "string" &&
                (rule.ifState === "on" || rule.ifState === "off") &&
                (rule.thenState === "on" || rule.thenState === "off")
              );
            }),
          }
        : {}),
      ...(Array.isArray(group.zones)
        ? {
            zones: group.zones
              .filter((z): z is Record<string, unknown> => {
                if (!z || typeof z !== "object") return false;
                const zone = z as Record<string, unknown>;
                return (
                  typeof zone.id === "string" &&
                  zone.kind === "editable" &&
                  typeof zone.startRow === "number" && Number.isFinite(zone.startRow) &&
                  typeof zone.endRow === "number" && Number.isFinite(zone.endRow)
                );
              })
              .map(
                (zone): SpecsGroupZone => ({
                  id: zone.id as string,
                  kind: "editable",
                  startRow: zone.startRow as number,
                  endRow: zone.endRow as number,
                  ...(Array.isArray(zone.linkedQuoteGroups)
                    ? {
                        linkedQuoteGroups: zone.linkedQuoteGroups.filter((r): r is LinkedQuoteGroupRef => {
                          if (!r || typeof r !== "object") return false;
                          const ref = r as Record<string, unknown>;
                          return (
                            typeof ref.quoteGroupName === "string" &&
                            ref.quoteGroupName.length > 0 &&
                            (ref.source === "group" || ref.source === "zone")
                          );
                        }),
                      }
                    : {}),
                }),
              ),
          }
        : {}),
    });
  }
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

// A manually-named, point-in-time snapshot of a project's own specifications sheet — created only
// via an explicit "Save Version" action (never automatically), so the list only ever grows when a
// user deliberately wants a checkpoint to come back to. `version` is a simple incrementing counter
// (not a timestamp) purely so the history's own save order is unambiguous even if two versions are
// saved within the same second.
export type SpecsGridVersion = {
  id: string;
  name: string;
  version: number;
  savedAtIso: string;
  savedByName?: string;
  grid: SpecsGrid;
  // Only ever set on the Quote grid's auto-captured "last closed" baseline (see
  // fetchProjectUpdatedAtMarker's own callers) — unused by Specs, which has no automatic/outdated-
  // detection concept, only the plain manual "Save Version" flow above.
  capturedProjectMarker?: string;
  // Set on a Specs OR Quote version saved WHILE it was actively shared with a client (see
  // saveSpecsSheetVersion / sendQuoteToClient in app/(app)/projects/[projectId]/page.tsx) — this
  // snapshot is the permanent record of exactly what the client saw at that point; the live sheet
  // resets to a fresh, editable draft immediately after.
  sentToClient?: boolean;
  // Quote only — set once the client accepts this specific frozen version (see
  // app/api/specs-share/[shareId]/accept). Written directly onto this version document (not just
  // the revocable/expirable specsShareLinks hub doc) so the acceptance record is permanent even
  // after the share link itself is later revoked or expires.
  acceptedAtIso?: string;
  acceptedByName?: string;
  // Specs only — set once the client submits their confirmation of this specific frozen version
  // (see app/api/specs-share/[shareId]/submit). Same permanent-record reasoning as
  // acceptedAtIso/acceptedByName above: written directly onto this version document, not just the
  // revocable/expirable specsShareLinks hub doc, and cleared (along with that hub doc's own
  // submittedAt/submittedByName) if staff ever reopen it for editing — see
  // reopenSpecsConfirmationForEditing in app/(app)/projects/[projectId]/page.tsx.
  submittedAtIso?: string;
  submittedByName?: string;
};

export function normalizeSpecsGridVersions(raw: unknown): SpecsGridVersion[] {
  if (!Array.isArray(raw)) return [];
  const out: SpecsGridVersion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const grid = normalizeSpecsGrid(row.grid);
    if (!grid) continue;
    const savedByName = typeof row.savedByName === "string" && row.savedByName ? row.savedByName : "";
    const capturedProjectMarker = typeof row.capturedProjectMarker === "string" && row.capturedProjectMarker ? row.capturedProjectMarker : "";
    const sentToClient = row.sentToClient === true;
    const acceptedAtIso = typeof row.acceptedAtIso === "string" && row.acceptedAtIso ? row.acceptedAtIso : "";
    const acceptedByName = typeof row.acceptedByName === "string" && row.acceptedByName ? row.acceptedByName : "";
    const submittedAtIso = typeof row.submittedAtIso === "string" && row.submittedAtIso ? row.submittedAtIso : "";
    const submittedByName = typeof row.submittedByName === "string" && row.submittedByName ? row.submittedByName : "";
    out.push({
      id: typeof row.id === "string" && row.id ? row.id : genSpecsRowId(),
      name: typeof row.name === "string" ? row.name : "",
      version: typeof row.version === "number" && Number.isFinite(row.version) ? row.version : 0,
      savedAtIso: typeof row.savedAtIso === "string" ? row.savedAtIso : "",
      // Firestore's setDoc rejects a literal `undefined` property value outright (throws
      // "invalid-argument") — these optional fields have to be genuinely ABSENT keys when there's
      // no value, not present keys holding `undefined`, since a normalized version like this one
      // routinely gets spread into a new array/document and written straight back (every "Save
      // Version" / "Update" flow that appends to an existing history list).
      ...(savedByName ? { savedByName } : {}),
      ...(capturedProjectMarker ? { capturedProjectMarker } : {}),
      ...(sentToClient ? { sentToClient } : {}),
      ...(acceptedAtIso ? { acceptedAtIso } : {}),
      ...(acceptedByName ? { acceptedByName } : {}),
      ...(submittedAtIso ? { submittedAtIso } : {}),
      ...(submittedByName ? { submittedByName } : {}),
      grid,
    });
  }
  return out;
}

// A single, standalone version entry (not the whole array) — used for the Quote grid's ephemeral
// "last closed" baseline, which is stored as one object (not a list) at
// salesPayload.quoteGridLastClosedVersion. Reuses the exact same shape/validation as an entry inside
// normalizeSpecsGridVersions' own array, just for a lone value instead of a list.
export function normalizeSpecsGridVersion(raw: unknown): SpecsGridVersion | null {
  if (!raw || typeof raw !== "object") return null;
  const [only] = normalizeSpecsGridVersions([raw]);
  return only ?? null;
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
  // Skip the FIRST empty row past the last content row — it's kept as a small trailing buffer so
  // the sheet doesn't end abruptly right against the last filled line. Only empty rows beyond that
  // one are actually dropped.
  const keepThroughRow = Math.min(lastContentRow + 1, grid.rows.length - 1);
  let working = grid;
  for (let r = working.rows.length - 1; r > keepThroughRow; r -= 1) {
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
      if (!cell) continue;
      if (typeof cell.text === "string") {
        cell.text = interpolateQuoteTemplateText(cell.text, replacements);
      }
      // A {{token}} is assumed to sit entirely within one run — a placeholder deliberately split
      // across a bold/plain boundary is a rare enough authoring choice that resolving it per-run
      // (simple, and correct for every normal case) is worth not chasing that edge case.
      if (cell.runs) {
        cell.runs = cell.runs.map((run) => ({ ...run, text: interpolateQuoteTemplateText(run.text, replacements) }));
      }
      // A brand-new project should never start with a cell already marked `confirmable` (an ACTIVE
      // question this round) — that's inherently a per-project, staff-chosen, per-round state, never
      // something a template should hand down. `confirmableAllowed` (the template's own eligibility
      // flag — see its own comment on SpecsCell) is deliberately left untouched; it's the one
      // confirmation-related trait that SHOULD carry over. Defensive even though the template
      // builder's own "Mark Confirmable" button only ever sets confirmableAllowed now — guards
      // against a template cell that somehow still has a stale confirmable/confirmedYes/confirmedAt
      // sitting on it (e.g. from before that button was split into two fields) silently carrying an
      // already-"Pending" or already-answered cell into every future project cloned from it.
      if (cell.confirmable || cell.confirmedYes !== undefined || cell.confirmedAt !== undefined) {
        delete cell.confirmable;
        delete cell.confirmedYes;
        delete cell.confirmedAt;
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

// Every field the group-editor modal (specs-grid-editor.tsx) submits together in one shot — since
// that's now a real form with controlled state for all of it at once (not an inline popover built up
// incrementally field-by-field), createRowGroup/renameRowGroup below take the whole thing as one
// object and just write it, rather than the old per-field-optional "undefined means leave this one
// alone" convention that only made sense when different callers touched different subsets.
export type SpecsRowGroupEditableFields = {
  name: string;
  price: string; // "" = no price
  defaultIncluded: boolean;
  anchorFirstPageBottom: boolean;
  editableByRoleIds: string[]; // [] = unrestricted
  category: string; // "" = uncategorized
  rules: SpecsGroupRule[]; // [] = no dependency rules
  // Quote links now live PER-ZONE (SpecsGroupZone.linkedQuoteGroups), not here — each zone object
  // inside this array already carries its own, so no separate group-level field is needed.
  zones: SpecsGroupZone[]; // [] = no zones — every cell in the group stays freely editable
};

export function createRowGroup(grid: SpecsGrid, startRow: number, endRow: number, fields: SpecsRowGroupEditableFields): SpecsGrid {
  const expanded = expandRowRangeToFullyContainSpans(grid, Math.min(startRow, endRow), Math.max(startRow, endRow));
  const group: SpecsRowGroup = {
    id: genSpecsGroupId(),
    name: fields.name,
    ...expanded,
    ...(fields.price ? { price: fields.price } : {}),
    // Always written as an explicit boolean, never omitted when false — Quote's own seeding
    // (`!g.defaultIncluded`) treats "omitted" and "explicit false" identically, so this is a no-op
    // for Quote either way, but Specs' seeding (`g.defaultIncluded === false`) NEEDS the explicit
    // false to tell "author deliberately turned Default off" apart from "never touched" (which has
    // to keep meaning "visible" for every pre-existing Specs group — see that seeding's own
    // comment). Omitting it here silently made every Specs group's Default:Off setting a no-op.
    defaultIncluded: fields.defaultIncluded,
    ...(fields.anchorFirstPageBottom ? { anchorFirstPageBottom: true } : {}),
    ...(fields.editableByRoleIds.length > 0 ? { editableByRoleIds: fields.editableByRoleIds } : {}),
    ...(fields.category ? { category: fields.category } : {}),
    ...(fields.rules.length > 0 ? { rules: fields.rules } : {}),
    ...(fields.zones.length > 0 ? { zones: fields.zones } : {}),
  };
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

// Writes every editable field at once (see SpecsRowGroupEditableFields' own comment) — id/startRow/
// endRow/hidden are the only things NOT owned by the group-editor modal, so those are the only
// fields carried over from the existing group rather than replaced.
export function renameRowGroup(grid: SpecsGrid, groupId: string, fields: SpecsRowGroupEditableFields): SpecsGrid {
  return {
    ...grid,
    groups: grid.groups.map((g) => {
      if (g.id !== groupId) return g;
      return {
        id: g.id,
        startRow: g.startRow,
        endRow: g.endRow,
        ...(g.hidden !== undefined ? { hidden: g.hidden } : {}),
        name: fields.name,
        ...(fields.price ? { price: fields.price } : {}),
        // Explicit boolean, never omitted when false — see createRowGroup's own identical comment.
        defaultIncluded: fields.defaultIncluded,
        ...(fields.anchorFirstPageBottom ? { anchorFirstPageBottom: true } : {}),
        ...(fields.editableByRoleIds.length > 0 ? { editableByRoleIds: fields.editableByRoleIds } : {}),
        ...(fields.category ? { category: fields.category } : {}),
        ...(fields.rules.length > 0 ? { rules: fields.rules } : {}),
        ...(fields.zones.length > 0 ? { zones: fields.zones } : {}),
      };
    }),
  };
}

export function setRowGroupHidden(grid: SpecsGrid, groupId: string, hidden: boolean): SpecsGrid {
  return { ...grid, groups: grid.groups.map((g) => (g.id === groupId ? { ...g, hidden } : g)) };
}

// Clears anchorFirstPageBottom from every OTHER group, so exactly one group (or none) is ever the
// current split point — multiple independently-anchored groups never had distinct meaning anyway
// (only the earliest start row among them was ever read, see buildSpecsGridPdfBlob's own
// computation), so this keeps that invariant explicit rather than leaving stray flags behind on
// groups the splitter-line UI no longer shows as "the" split. `groupId: null` clears the split
// entirely (no group anchored, every group just flows top-down like normal).
export function setAnchorSplitGroup(grid: SpecsGrid, groupId: string | null): SpecsGrid {
  return {
    ...grid,
    groups: grid.groups.map((g) => {
      if (g.id === groupId) return { ...g, anchorFirstPageBottom: true };
      if (!g.anchorFirstPageBottom) return g;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { anchorFirstPageBottom: _removed, ...rest } = g;
      return rest;
    }),
  };
}

export function removeRowGroup(grid: SpecsGrid, groupId: string): SpecsGrid {
  return { ...grid, groups: grid.groups.filter((g) => g.id !== groupId) };
}

// Strips confirmable/confirmedYes/confirmedAt off EVERY cell — called on the LIVE sheet the moment
// it's sent (see sendSpecsToClient in app/(app)/projects/[projectId]/page.tsx), since the version
// actually bound to the client link is a separate, already-snapshotted copy (which keeps its own
// markers untouched). Without this, the live sheet kept showing every cell that was ever marked for
// confirmation as still blue-ringed/"Pending" forever — that grid's own copy of the answer never
// gets updated once a version's been sent (only the version document does), so those markers on
// live are permanently stale the moment they're sent. Staff mark a fresh set on live for whatever
// the NEXT round of confirmation should be, independent of what was already sent.
export function clearAllConfirmableMarks(grid: SpecsGrid): SpecsGrid {
  return {
    ...grid,
    rows: grid.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => {
        if (!cell || !cell.confirmable) return cell;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { confirmable: _removedConfirmable, confirmedYes: _removedYes, confirmedAt: _removedAt, ...rest } = cell;
        return rest;
      }),
    })),
  };
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

// True if `absoluteRow` (a real row index into the grid, same coordinate space as group.startRow
// itself) falls inside one of this group's own zones — each zone's own startRow/endRow is relative
// to the group's startRow (0 = the group's own first row), not the grid's absolute indices, so this
// is the one place that translation happens; nothing else needs to know about it.
export function isRowWithinGroupZone(group: SpecsRowGroup, absoluteRow: number): boolean {
  return (group.zones ?? []).some(
    (z) => absoluteRow >= group.startRow + z.startRow && absoluteRow <= group.startRow + z.endRow,
  );
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
// row's OWN previously-empty cells once insertRow has placed it. The one exception to "never the
// source's own data": `confirmableAllowed` and `confirmable` DO carry over — a row whose cell is
// already eligible (or already actively set up as a client Yes/No question this round) is almost
// always being duplicated specifically to add ANOTHER line item of the exact same kind (e.g. a
// repeatable "include this option? Yes/No" row), and without this the new row would silently lose
// its own "Mark for Confirmation" button (confirmableAllowed) or stop being an active question
// (confirmable) entirely, undoing the whole point of duplicating it. `confirmedYes`/`confirmedAt`
// never carry over regardless — those are a specific CLIENT'S answer to the source row, not
// something a brand-new, not-yet-asked row could possibly already have.
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
      return {
        text: "",
        style: sourceCell.style,
        rowSpan: 1,
        colSpan,
        ...(sourceCell.confirmableAllowed ? { confirmableAllowed: true as const } : {}),
        ...(sourceCell.confirmable ? { confirmable: true as const } : {}),
      };
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

// Trims leading whitespace off the first run's text and trailing whitespace off the last run's text
// (dropping any run left fully empty at either end) WITHOUT touching bold/underline on any run or
// any internal whitespace — the per-run equivalent of plain string .trim(), used so importing a
// Quote cell's formatted text doesn't also drag in the stray surrounding newline/space a staff
// member's own line breaks between cells would otherwise leave behind.
function trimCellRuns(runs: SpecsTextRun[]): SpecsTextRun[] {
  const trimmed = runs.map((r) => ({ ...r }));
  while (trimmed.length > 0 && !trimmed[0].text.trim()) trimmed.shift();
  while (trimmed.length > 0 && !trimmed[trimmed.length - 1].text.trim()) trimmed.pop();
  if (trimmed.length > 0) {
    trimmed[0].text = trimmed[0].text.replace(/^\s+/, "");
    trimmed[trimmed.length - 1].text = trimmed[trimmed.length - 1].text.replace(/\s+$/, "");
  }
  return trimmed;
}

// Concatenates run blocks (e.g. one per source cell, or one per source group) with a plain,
// unformatted separator run between each pair — used to join cell-level and group-level text
// together the same way the plain-text version of this used to join with "\n"/"\n\n" strings, just
// keeping each block's own bold/underline runs intact instead of flattening to plain text first.
function joinRunBlocks(blocks: SpecsTextRun[][], separator: string): SpecsTextRun[] {
  const joined: SpecsTextRun[] = [];
  blocks.forEach((block, i) => {
    if (i > 0) joined.push({ text: separator });
    joined.push(...block);
  });
  return joined;
}

// Every real (non-null) cell's own text RUNS (preserving bold/underline) within an ABSOLUTE row
// range of `grid`, in reading order — shared by importLinkedQuoteTextIntoZone below for both a
// LinkedQuoteGroupRef's "group" source (the ref's own full startRow..endRow) and its "zone" source
// (that same quote group's own editable zone's absolute range, computed by the caller). A null cell
// is covered by an earlier cell's own merge, not real content, and is skipped the same way the rest
// of this file already treats one. A cell that's blank once trimmed (no real text, formatted or not)
// is skipped too, same as the plain-text version this replaced.
function collectCellRunsInRowRange(grid: SpecsGrid, startRow: number, endRow: number): SpecsTextRun[][] {
  const blocks: SpecsTextRun[][] = [];
  for (let r = startRow; r <= endRow; r += 1) {
    for (const cell of grid.rows[r]?.cells ?? []) {
      if (!cell) continue;
      const trimmed = trimCellRuns(getCellRuns(cell));
      if (trimmed.some((run) => run.text)) blocks.push(trimmed);
    }
  }
  return blocks;
}

// Fills a SPECS group's own "editable" zone (see SpecsGroupZone) with the combined text of that
// zone's OWN `linkedQuoteGroups` (see LinkedQuoteGroupRef) — deliberately NOT the row-structure-
// replacing splice an earlier version of this did. That version transplanted Quote's own row/cell
// structure wholesale into Specs, destroying any Specs-specific formatting or hand-added content
// every time. This version instead leaves the Specs group's own layout, borders, and merges exactly
// as authored, and only ever overwrites the TEXT of the zone's one real (anchor) cell — "leave the
// cell how it is if merged and just combine the imported text into 1 cell," per the user's own
// description. The imported text's own RUN-level formatting (bold/underline) carries over from the
// Quote cells it came from — only the anchor cell's whole-cell style (font size/color, fill,
// borders, alignment) stays exactly as authored in Specs, untouched by the import. A manual,
// one-shot REPLACE of that cell's text (not a merge): any hand-edit to the zone since the last
// import is discarded, same as any other undoable edit in this editor (Ctrl+Z recovers it, there's
// no separate confirm step here).
//
// Finds the one real (non-null) anchor cell within a SPECS group's own "editable" zone — shared by
// importLinkedQuoteTextIntoZone below (to know where to write imported text) and
// getEditableZoneText below it (to read the zone's CURRENT content, e.g. to detect a manual edit
// since the last import, before silently overwriting it again).
function findEditableZoneAnchor(grid: SpecsGrid, groupId: string): { row: number; col: number; zone: SpecsGroupZone } | null {
  const target = getExpandedRowGroups(grid).find((g) => g.id === groupId);
  const zone = target?.zones?.find((z) => z.kind === "editable");
  if (!target || !zone) return null;
  const absStart = target.startRow + zone.startRow;
  const absEnd = target.startRow + zone.endRow;
  for (let r = absStart; r <= absEnd; r += 1) {
    const row = grid.rows[r];
    if (!row) continue;
    for (let c = 0; c < row.cells.length; c += 1) {
      if (row.cells[c]) return { row: r, col: c, zone };
    }
  }
  return null;
}

// Current plain text of a Specs group's own editable zone anchor cell — "" if the group, its
// editable zone, or a real anchor cell within it don't exist. The caller (specs-grid-editor.tsx)
// compares this against what it last wrote via importLinkedQuoteTextIntoZone to decide whether the
// zone has been hand-edited since, and if so, confirm before the next import silently replaces it.
export function getEditableZoneText(grid: SpecsGrid, groupId: string): string {
  const anchor = findEditableZoneAnchor(grid, groupId);
  if (!anchor) return "";
  const cell = grid.rows[anchor.row]?.cells[anchor.col];
  return cell ? runsToPlainText(getCellRuns(cell)).trim() : "";
}

// No group, no `editable` zone, or no linked refs that resolve to anything → a safe no-op (the
// zone's content is left completely untouched, never emptied). Returns how many linked refs actually
// resolved to real content and how many didn't (name renamed/deleted, or a "zone" source pointing at
// a Quote group with no editable zone of its own), purely so the caller's UI can report something
// like "Imported 2 — 1 group no longer exists and was skipped." `importedText` is the plain text
// actually written (`""` on a no-op), likewise for the caller — see getEditableZoneText's own
// comment above.
export function importLinkedQuoteTextIntoZone(
  specsGrid: SpecsGrid,
  quoteGrid: SpecsGrid,
  specsGroupId: string,
): { grid: SpecsGrid; pulledCount: number; skippedCount: number; importedText: string } {
  const target = getExpandedRowGroups(specsGrid).find((g) => g.id === specsGroupId);
  const zone = target?.zones?.find((z) => z.kind === "editable");
  if (!target || !zone) return { grid: specsGrid, pulledCount: 0, skippedCount: 0, importedText: "" };
  const linkedRefs = zone.linkedQuoteGroups ?? [];
  // First match wins on a duplicate name — same tolerant-but-simple convention as
  // SpecsGroupRule.ifProductName matching elsewhere in this file.
  const quoteGroupsByName = new Map<string, SpecsRowGroup>();
  for (const g of getExpandedRowGroups(quoteGrid)) {
    if (!quoteGroupsByName.has(g.name)) quoteGroupsByName.set(g.name, g);
  }
  const groupRunBlocks: SpecsTextRun[][] = [];
  let pulledCount = 0;
  let skippedCount = 0;
  for (const ref of linkedRefs) {
    const quoteGroup = quoteGroupsByName.get(ref.quoteGroupName);
    if (!quoteGroup) {
      skippedCount += 1;
      continue;
    }
    // A group toggled off (hidden — the Quote window's own show/hide-from-print toggle) is the
    // staff member deliberately excluding it from what the client sees, which should carry through
    // to the import too — not counted as `skippedCount` (that's reserved for something actually
    // wrong, like a renamed/deleted group), just silently left out, same as if it had never been
    // linked for this particular import.
    if (quoteGroup.hidden) continue;
    let cellRunBlocks: SpecsTextRun[][];
    if (ref.source === "zone") {
      const quoteZone = quoteGroup.zones?.find((z) => z.kind === "editable");
      if (!quoteZone) {
        // Explicitly skipped, not silently falling back to the whole group — see this function's
        // own comment and LinkedQuoteGroupRef.source's own comment for why.
        skippedCount += 1;
        continue;
      }
      cellRunBlocks = collectCellRunsInRowRange(quoteGrid, quoteGroup.startRow + quoteZone.startRow, quoteGroup.startRow + quoteZone.endRow);
    } else {
      cellRunBlocks = collectCellRunsInRowRange(quoteGrid, quoteGroup.startRow, quoteGroup.endRow);
    }
    pulledCount += 1;
    if (cellRunBlocks.length > 0) groupRunBlocks.push(joinRunBlocks(cellRunBlocks, "\n"));
  }
  if (pulledCount === 0) return { grid: specsGrid, pulledCount, skippedCount, importedText: "" };
  const combinedRuns = normalizeTextRuns(joinRunBlocks(groupRunBlocks, "\n\n"));
  const importedText = runsToPlainText(combinedRuns);
  const anchor = findEditableZoneAnchor(specsGrid, specsGroupId);
  // No real cell found in the zone's own range (shouldn't normally happen — a zone is meant to be
  // marked over a cell that already exists) — nothing safe to write the text into.
  if (!anchor) return { grid: specsGrid, pulledCount, skippedCount, importedText: "" };
  const rows = specsGrid.rows.map((row, r) => {
    if (r !== anchor.row) return row;
    const cells = row.cells.map((cell, c) => {
      if (c !== anchor.col || !cell) return cell;
      return { ...cell, text: importedText, runs: combinedRuns };
    });
    return { ...row, cells };
  });
  return { grid: { ...specsGrid, rows }, pulledCount, skippedCount, importedText };
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
