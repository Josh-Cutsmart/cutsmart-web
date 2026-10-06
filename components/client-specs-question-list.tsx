"use client";

import { Check, X } from "lucide-react";
import { getCellSpan, getExpandedRowGroups, type SpecsGrid } from "@/lib/specs-grid-types";

// The client portal's phone/tablet way of answering the Specifications sheet's Yes/No questions
// (app/client/hub/[shareId], shown below lg only). On a phone the sheet itself is scaled down to fit
// the screen (see SpecsGridClientView's fitToWidth), which leaves its in-sheet Yes/No toggles a few
// px tall — too small to tap reliably. This lists the same questions with full-size buttons; both
// write through the same onAnswer and read the same grid, so answering here or on the sheet is the
// same thing. Uses the portal's own fixed light palette (no app theme on this public page).

type Question = {
  key: string;
  rowId: string;
  colIndex: number;
  label: string;
  answer: boolean | undefined;
};

const plainText = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

// A confirmable cell's own text is hidden under its Yes/No toggle on the sheet, so the question is
// really "this row": its label is the text of every other cell sharing the row (including a merged
// cell from further up whose span reaches it), left to right. Skips rows in hidden groups, exactly
// like the sheet does.
function collectQuestions(grid: SpecsGrid): Question[] {
  const hiddenRows = new Set<number>();
  for (const g of getExpandedRowGroups(grid)) {
    if (!g.hidden) continue;
    for (let r = g.startRow; r <= g.endRow; r += 1) hiddenRows.add(r);
  }
  const questions: Question[] = [];
  grid.rows.forEach((row, rowIdx) => {
    if (hiddenRows.has(rowIdx)) return;
    row.cells.forEach((cell, colIdx) => {
      if (!cell?.confirmable) return;
      const lastRow = rowIdx + getCellSpan(cell).rowSpan - 1;
      const pieces: { col: number; row: number; text: string }[] = [];
      for (let r = 0; r <= lastRow && r < grid.rows.length; r += 1) {
        if (hiddenRows.has(r)) continue;
        grid.rows[r].cells.forEach((other, c) => {
          if (!other || other.confirmable || other.imageUrl) return;
          if (r + getCellSpan(other).rowSpan - 1 < rowIdx) return;
          const text = plainText(other.text);
          if (text) pieces.push({ col: c, row: r, text });
        });
      }
      pieces.sort((a, b) => a.col - b.col || a.row - b.row);
      const label = Array.from(new Set(pieces.map((p) => p.text))).join(" · ") || plainText(cell.text) || `Item ${questions.length + 1}`;
      questions.push({ key: `${row.id}:${colIdx}`, rowId: row.id, colIndex: colIdx, label, answer: cell.confirmedYes });
    });
  });
  return questions;
}

export default function ClientSpecsQuestionList({
  grid,
  onAnswer,
  answeringKey,
}: {
  grid: SpecsGrid;
  // `value: null` means "clear this answer" — same contract as SpecsGridClientView's own onAnswer.
  onAnswer: (rowId: string, colIndex: number, value: boolean | null) => void;
  answeringKey: string | null;
}) {
  const questions = collectQuestions(grid);
  if (!questions.length) return null;
  const answeredCount = questions.filter((q) => q.answer !== undefined).length;

  return (
    <div className="overflow-hidden rounded-[10px] border" style={{ borderColor: "#D8DEE8", backgroundColor: "#FFFFFF" }}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "#E2E8F0", backgroundColor: "#F8FAFC" }}>
        <p className="text-[13px] font-semibold" style={{ color: "#0F172A" }}>Please confirm</p>
        <p className="shrink-0 text-[12px] font-medium" style={{ color: "#64748B" }}>
          {answeredCount} of {questions.length} answered
        </p>
      </div>
      {questions.map((q) => {
        // Same key format as the hub page's own answeringKey — disables just this question's two
        // buttons while its answer is in flight, like the sheet's toggle.
        const isAnswering = answeringKey === q.key;
        return (
          <div key={q.key} className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0" style={{ borderColor: "#E2E8F0" }}>
            <p className="min-w-0 flex-1 break-words text-[13px] font-medium" style={{ color: "#0F172A" }}>
              {q.label}
            </p>
            {/* Same rule as the sheet's own toggle: pressing the side that's already selected clears it. */}
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={isAnswering}
                aria-pressed={q.answer === true}
                onClick={() => onAnswer(q.rowId, q.colIndex, q.answer === true ? null : true)}
                className="inline-flex h-11 min-w-[60px] items-center justify-center gap-1 rounded-[10px] border px-3 text-[12px] font-bold disabled:opacity-60"
                style={
                  q.answer === true
                    ? { borderColor: "#15803D", backgroundColor: "#15803D", color: "#FFFFFF" }
                    : { borderColor: "#D8DEE8", backgroundColor: "#FFFFFF", color: "#334155" }
                }
              >
                <Check size={14} strokeWidth={3} />
                Yes
              </button>
              <button
                type="button"
                disabled={isAnswering}
                aria-pressed={q.answer === false}
                onClick={() => onAnswer(q.rowId, q.colIndex, q.answer === false ? null : false)}
                className="inline-flex h-11 min-w-[60px] items-center justify-center gap-1 rounded-[10px] border px-3 text-[12px] font-bold disabled:opacity-60"
                style={
                  q.answer === false
                    ? { borderColor: "#B42318", backgroundColor: "#B42318", color: "#FFFFFF" }
                    : { borderColor: "#D8DEE8", backgroundColor: "#FFFFFF", color: "#334155" }
                }
              >
                <X size={14} strokeWidth={3} />
                No
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
