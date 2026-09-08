"use client";

import { Fragment } from "react";
import { Check, X } from "lucide-react";
import {
  getCellRuns,
  getCellSpan,
  getExpandedRowGroups,
  computeBorderSegments,
  computeSpecsPageBoxWidthPx,
  SPECS_PAGE_SIZES,
  SPECS_PAGE_MARGIN_MM,
  MM_TO_PX,
  DEFAULT_COL_WIDTH_PX,
  DEFAULT_ROW_HEIGHT_PX,
  DEFAULT_CELL_FONT_SIZE_PX,
  type SpecsCell,
  type SpecsCellStyle,
  type SpecsGrid,
} from "@/lib/specs-grid-types";

export type SpecsGridClientViewProps = {
  grid: SpecsGrid;
  // True once the client has submitted (see app/api/specs-share/[shareId]/submit) — every
  // confirmable cell renders its current Yes/No as plain, non-interactive text instead of a
  // clickable toggle.
  locked: boolean;
  // `value: null` means "clear this answer" — clicking an already-selected Yes/No un-selects it.
  onAnswer: (rowId: string, colIndex: number, value: boolean | null) => void;
  // "rowId:colIndex" of whichever answer is currently in flight, so that one toggle can show a
  // brief pending state without disabling the whole sheet.
  answeringKey?: string | null;
  // Widens the rendered mock-page box to at least this width — never shrinks it below what this
  // grid's own columns need. Used by the client hub page (app/client/hub/[shareId]) so the
  // Specifications and Quote tabs render as the same-size sheet regardless of which one has wider
  // columns, instead of visibly resizing when a client switches tabs.
  boxWidthPx?: number;
};

// Reuses the same align/verticalAlign fields text cells use — matches
// components/specs-grid-editor.tsx's own imageObjectPositionFor exactly, so an image cell frames
// identically here as it does in a project's own copy.
function imageObjectPositionFor(style: SpecsCellStyle): string {
  const horizontal = style.align === "left" ? "left" : style.align === "right" ? "right" : "center";
  const vertical = style.verticalAlign === "top" ? "top" : style.verticalAlign === "bottom" ? "bottom" : "center";
  return `${horizontal} ${vertical}`;
}

// A read-only render of a SpecsGrid for the external client hub page
// (app/client/hub/[shareId]) — deliberately NOT <SpecsGridEditor>: no merge-editing, resizing,
// formatting toolbar, or image-insert UI belongs in front of someone with no CutSmart login. Only a
// confirmable cell (see lib/specs-grid-types.ts's SpecsCell.confirmable) gets any interactive
// element at all, and only when `locked` is false.
//
// Deliberately mirrors specs-grid-editor.tsx's own project-sheet ("isProjectSheetView") rendering
// pixel-for-pixel — same mock-page sizing (SPECS_PAGE_SIZES/SPECS_PAGE_MARGIN_MM), same row/column
// prefix-sum geometry, same computeBorderSegments overlay for explicit borders (rather than a
// blanket 1px gridline on every cell, which the real sheet never draws), same cell padding/font
// fallbacks, and the same hidden-row-group filtering — so what the client sees is the same document
// staff see, not a differently-scaled approximation of it.
export default function SpecsGridClientView({ grid, locked, onAnswer, answeringKey, boxWidthPx }: SpecsGridClientViewProps) {
  const expandedGroups = getExpandedRowGroups(grid);
  const hiddenRowIndexes = new Set<number>();
  for (const g of expandedGroups) {
    if (!g.hidden) continue;
    for (let r = g.startRow; r <= g.endRow; r += 1) hiddenRowIndexes.add(r);
  }

  const safeColumnWidths = grid.columnWidths.map((w) => (typeof w === "number" && Number.isFinite(w) && w > 0 ? w : DEFAULT_COL_WIDTH_PX));
  const safeRowHeights = grid.rows.map((r, ri) =>
    hiddenRowIndexes.has(ri) ? 0 : typeof r.heightPx === "number" && Number.isFinite(r.heightPx) && r.heightPx > 0 ? r.heightPx : DEFAULT_ROW_HEIGHT_PX,
  );

  const colPrefixSums: number[] = [0];
  for (const w of safeColumnWidths) colPrefixSums.push(colPrefixSums[colPrefixSums.length - 1] + w);
  const tableTotalWidthPx = colPrefixSums[colPrefixSums.length - 1] ?? 0;
  const rowPrefixSums: number[] = [0];
  for (const h of safeRowHeights) rowPrefixSums.push(rowPrefixSums[rowPrefixSums.length - 1] + h);

  const mockPageMarginPx = Math.round(SPECS_PAGE_MARGIN_MM * MM_TO_PX);
  const mockPageHeightPx = Math.round(SPECS_PAGE_SIZES[grid.pageSize].heightMm * MM_TO_PX);

  // anchorFirstPageBottom (see its own comment on SpecsRowGroup) — ported from
  // specs-grid-editor.tsx's own project-sheet view verbatim, so a group like "Footer Bar"/"T&C"
  // pinned to the bottom of page 1 there renders in the SAME place here, instead of just sitting
  // wherever it naturally falls in the row flow. See that file's own comment on this exact block
  // for the full reasoning (inflating rowPrefixSums in place, before any consumer reads it, plus a
  // real blank spacer <tr> in the table's own native row flow, rendered further down).
  let anchorSpacerPx = 0;
  let anchorSpacerBeforeRowIdx = -1;
  let rowBottomEdgeSums = rowPrefixSums;
  const anchoredGroups = expandedGroups.filter((g) => g.anchorFirstPageBottom && !g.hidden);
  if (anchoredGroups.length > 0) {
    const anchorStartRow = Math.min(...anchoredGroups.map((g) => g.startRow));
    const usableHeightPx = mockPageHeightPx - mockPageMarginPx * 2;
    const heightBeforeAnchorPx = rowPrefixSums[anchorStartRow] ?? 0;
    const heightFromAnchorPx = (rowPrefixSums[rowPrefixSums.length - 1] ?? 0) - heightBeforeAnchorPx;
    const requiredSpacerPx = usableHeightPx - heightBeforeAnchorPx - heightFromAnchorPx;
    if (requiredSpacerPx > 0.5) {
      const naturalAnchorTop = rowPrefixSums[anchorStartRow];
      for (let i = anchorStartRow; i < rowPrefixSums.length; i += 1) rowPrefixSums[i] += requiredSpacerPx;
      rowBottomEdgeSums = rowPrefixSums.slice();
      rowBottomEdgeSums[anchorStartRow] = naturalAnchorTop;
      anchorSpacerPx = requiredSpacerPx;
      anchorSpacerBeforeRowIdx = anchorStartRow;
    }
  }

  const borderSegments = computeBorderSegments(grid, colPrefixSums, rowPrefixSums, rowBottomEdgeSums, hiddenRowIndexes);
  const tableRenderedHeightPx = (rowPrefixSums[rowPrefixSums.length - 1] ?? 0) + mockPageMarginPx * 2;
  // Shared with app/client/hub/[shareId]/page.tsx (see that function's own comment) so the
  // "Submit"/"Accept" bars above/below this component are sized to match this page's own width
  // exactly. Never shrinks below what this grid's own columns actually need — boxWidthPx only ever
  // widens the box (extra blank margin on the right), it never clips or rescales the table itself.
  const mockPageBoxWidthPx = Math.max(computeSpecsPageBoxWidthPx(grid), boxWidthPx ?? 0);
  // Same "only ever grows past the paper size, never shrinks below it" rule as the editor's own mock
  // page — a visual reference for how this prints, not a hard crop.
  const mockPageBoxHeightPx = Math.max(mockPageHeightPx, tableRenderedHeightPx);

  return (
    <div className="overflow-x-auto">
      <div
        className="relative mx-auto"
        style={{ width: mockPageBoxWidthPx, minHeight: mockPageBoxHeightPx, backgroundColor: "#ffffff", boxShadow: "0 1px 4px rgba(16, 24, 40, 0.15)" }}
      >
        <div className="relative" style={{ position: "absolute", left: mockPageMarginPx, top: mockPageMarginPx }}>
          <table style={{ tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, width: tableTotalWidthPx }}>
            <colgroup>
              {safeColumnWidths.map((w, idx) => (
                <col key={idx} style={{ width: w }} />
              ))}
            </colgroup>
            <tbody>
              {grid.rows.map((row, rowIdx) => {
                if (hiddenRowIndexes.has(rowIdx)) return null;
                return (
                <Fragment key={row.id}>
                  {rowIdx === anchorSpacerBeforeRowIdx ? (
                    // The real, native-table-flow counterpart to the rowPrefixSums shift above —
                    // that shift alone only moves the border overlay and this row's own visual
                    // position; the table's actual row stacking needs an actual blank row too, or
                    // every row from here on would just sit directly under the previous one. See
                    // specs-grid-editor.tsx's own identical spacer <tr> for the full reasoning.
                    <tr aria-hidden="true">
                      <td colSpan={grid.columnWidths.length} style={{ height: anchorSpacerPx, padding: 0, border: "none", background: "transparent" }} />
                    </tr>
                  ) : null}
                  <tr style={{ height: safeRowHeights[rowIdx] }}>
                    {row.cells.map((cell, colIdx) => {
                      if (cell === null) return null;
                      const { rowSpan, colSpan } = getCellSpan(cell);
                      const style = cell.style ?? {};
                      // Must match app/client/hub/[shareId]/page.tsx's own `answeringKey` format
                      // (`${rowId}:${colIndex}`) exactly — a mismatched separator here meant
                      // `isAnswering` was silently always false, so the Yes/No buttons were never
                      // actually disabled while a request for this same cell was in flight. That let
                      // a rapid second click fire a second overlapping request before the first
                      // resolved; if the first one then failed (or simply resolved after the second),
                      // its own failure-revert used a stale pre-second-click snapshot, visibly
                      // "flicking" the selection back to what it was before the second click.
                      const key = `${row.id}:${colIdx}`;
                      const isAnswering = answeringKey === key;
                      let spannedHeightPx = safeRowHeights[rowIdx];
                      if (rowSpan > 1) {
                        spannedHeightPx = 0;
                        for (let idx = rowIdx; idx < rowIdx + rowSpan && idx < grid.rows.length; idx += 1) {
                          spannedHeightPx += safeRowHeights[idx];
                        }
                      }
                      return (
                        <td
                          key={key}
                          rowSpan={rowSpan > 1 ? rowSpan : undefined}
                          colSpan={colSpan > 1 ? colSpan : undefined}
                          className={cell.imageUrl ? "p-0" : "p-0"}
                          style={{
                            position: "relative",
                            // Hard-capped, exactly like specs-grid-editor.tsx's own project-sheet
                            // cells — a row's real rendered height must always equal
                            // safeRowHeights[rowIdx] exactly, since that's the same figure
                            // rowPrefixSums (and therefore the border overlay below) was computed
                            // from. Letting a cell grow past it (e.g. to fit a Yes/No control) would
                            // desync every border segment below it from where its row actually
                            // renders — which is exactly why the interactive control is a small
                            // ABSOLUTE overlay (see ConfirmToggle) rather than something that takes
                            // up its own flow space here.
                            height: spannedHeightPx,
                            overflow: "hidden",
                            backgroundColor: style.bgColor ?? "#ffffff",
                            // No gridline at all on a plain cell — explicit borders are drawn as the
                            // separate overlay below. Unlike specs-grid-editor.tsx's own staff-facing
                            // view, a confirmable cell gets no extra marker here — the Yes/No control
                            // itself is the only affordance the client sees, keeping this read exactly
                            // like the plain specification form otherwise.
                            boxShadow: undefined,
                          }}
                        >
                          {cell.imageUrl ? (
                            <div style={{ position: "relative", width: "100%", height: spannedHeightPx }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={cell.imageUrl}
                                alt=""
                                className="absolute inset-0 object-contain"
                                style={{ width: "100%", height: "100%", objectPosition: imageObjectPositionFor(style) }}
                              />
                            </div>
                          ) : (
                            <div
                              style={{
                                height: spannedHeightPx,
                                overflow: "hidden",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: style.verticalAlign === "middle" ? "center" : style.verticalAlign === "bottom" ? "flex-end" : "flex-start",
                              }}
                            >
                              <div
                                className="whitespace-pre-wrap break-words px-2 py-0.5"
                                style={{
                                  fontFamily: style.fontFamily || "inherit",
                                  fontSize: `${style.fontSize ?? DEFAULT_CELL_FONT_SIZE_PX}px`,
                                  textAlign: style.align ?? "left",
                                  color: style.textColor ?? "var(--text-main)",
                                }}
                              >
                                {getCellRuns(cell).map((run, runIdx) => (
                                  <span key={runIdx} style={{ fontWeight: run.bold ? 700 : 400, textDecoration: run.underline ? "underline" : "none" }}>
                                    {run.text}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {cell.confirmable ? (
                            <ConfirmToggle
                              cell={cell}
                              locked={locked}
                              isAnswering={isAnswering}
                              rowHeightPx={spannedHeightPx}
                              onAnswer={(value) => onAnswer(row.id, colIdx, value)}
                            />
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

          {borderSegments.map((seg, i) => (
            <div key={i} className="pointer-events-none absolute" style={{ left: seg.left, top: seg.top, width: seg.width, height: seg.height, backgroundColor: seg.color }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Fills the ENTIRE cell (position:absolute inset:0) rather than floating a small control inside
// it — the cell itself is already hard-capped to the sheet's own configured row height (see the
// td's own comment on why), so this can size itself to 100%/100% of that box without ever risking
// the row-growth/border-desync problem a flow-participating control would cause. Split exactly in
// half: the left side is always "Yes", the right always "No", each spanning the cell's full height.
function ConfirmToggle({
  cell,
  locked,
  isAnswering,
  rowHeightPx,
  onAnswer,
}: {
  cell: SpecsCell;
  locked: boolean;
  isAnswering: boolean;
  rowHeightPx: number;
  // `value: null` means "clear this answer".
  onAnswer: (value: boolean | null) => void;
}) {
  const iconSize = Math.max(10, Math.min(rowHeightPx - 6, 20));

  if (locked) {
    const state = cell.confirmedYes;
    return (
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{
          backgroundColor: state === undefined ? "var(--panel-muted)" : state ? "var(--success-soft)" : "var(--danger-soft)",
          color: state === undefined ? "var(--text-muted)" : state ? "var(--success-strong)" : "var(--danger-strong)",
        }}
      >
        {state === undefined ? <span style={{ fontSize: Math.min(iconSize, 12), fontWeight: 700 }}>—</span> : state ? <Check size={iconSize} strokeWidth={3} /> : <X size={iconSize} strokeWidth={3} />}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex">
      <button
        type="button"
        disabled={isAnswering}
        // Clicking an already-selected side un-selects it instead of re-sending the same answer.
        onClick={() => onAnswer(cell.confirmedYes === true ? null : true)}
        title="Yes"
        className="flex flex-1 items-center justify-center border-r disabled:opacity-60"
        style={{
          borderColor: "#D8DEE8",
          backgroundColor: cell.confirmedYes === true ? "#15803D" : "#FFFFFF",
          color: cell.confirmedYes === true ? "#FFFFFF" : "#334155",
        }}
      >
        <Check size={iconSize} strokeWidth={3} />
      </button>
      <button
        type="button"
        disabled={isAnswering}
        onClick={() => onAnswer(cell.confirmedYes === false ? null : false)}
        title="No"
        className="flex flex-1 items-center justify-center disabled:opacity-60"
        style={{
          backgroundColor: cell.confirmedYes === false ? "#B42318" : "#FFFFFF",
          color: cell.confirmedYes === false ? "#FFFFFF" : "#334155",
        }}
      >
        <X size={iconSize} strokeWidth={3} />
      </button>
    </div>
  );
}
