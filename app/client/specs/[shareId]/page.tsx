"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useParams } from "next/navigation";
import SpecsGridClientView from "@/components/specs-grid-client-view";
import { computeSpecsPageBoxWidthPx, type SpecsCell, type SpecsGrid } from "@/lib/specs-grid-types";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";

type Phase = "loading" | "viewing" | "load-error";

const ERROR_MESSAGES: Record<string, string> = {
  "not-found": "This link isn't valid. Please check the email again.",
  "expired": "This link has expired. Ask for a new one to be sent.",
  "project-not-found": "We couldn't find the specifications for this link.",
  "no-specifications-sheet": "There's no specifications sheet on this project yet.",
};

function errorMessageFor(error: string | undefined): string {
  if (!error) return "Something went wrong. Please try again.";
  return ERROR_MESSAGES[error] ?? "Something went wrong. Please try again.";
}

// Shown both above and below the sheet (see the render body) — full width of the page preview
// itself (computeSpecsPageBoxWidthPx), not just a small banner, so it's not something a client
// could miss even on a long sheet they've scrolled all the way down.
function SubmitBar({ onSubmitClick }: { onSubmitClick: (e: ReactMouseEvent<HTMLButtonElement>) => void }) {
  return (
    <div className="flex items-center justify-between rounded-[10px] border px-4 py-3" style={{ borderColor: "#D8DEE8", backgroundColor: "#FFFFFF" }}>
      <p className="text-[12px]" style={{ color: "#334155" }}>
        You can change your answers as many times as you like. When everything looks right, submit to finalize.
      </p>
      <button
        type="button"
        onClick={onSubmitClick}
        className="h-9 shrink-0 rounded-[8px] px-4 text-[12px] font-bold text-white"
        style={{ backgroundColor: "#2F6BFF" }}
      >
        Submit
      </button>
    </div>
  );
}

export default function ClientSpecsSharePage() {
  const params = useParams<{ shareId: string }>();
  const shareId = String(params?.shareId ?? "");

  const [phase, setPhase] = useState<Phase>("loading");

  const [grid, setGrid] = useState<SpecsGrid | null>(null);
  const [projectName, setProjectName] = useState("");
  const [confirmationSubmittedAt, setConfirmationSubmittedAt] = useState<string | null>(null);
  const [confirmationSubmittedByName, setConfirmationSubmittedByName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  const [answeringKey, setAnsweringKey] = useState<string | null>(null);

  const [showSubmitModal, setShowSubmitModal] = useState(false);
  // Which Submit button (top or bottom bar) opened the modal — captured at click time (see
  // captureGlassModalOrigin's own comment on why it can't be read later) so the modal grows out of
  // THAT button, the same "pop" animation every other modal in the app uses.
  const [submitModalOrigin, setSubmitModalOrigin] = useState<GlassModalOrigin>(null);
  const submitModalPanelRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderSubmitModal = useGlassModalPopOrigin(showSubmitModal, submitModalOrigin, submitModalPanelRef);
  const [submitNameDraft, setSubmitNameDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // No access code — the link itself (this shareId) is the only secret, per the user's explicit
  // call that a separate code isn't worth the friction for how unlikely the URL is to be guessed.
  // See lib/specs-share.ts's buildSpecsConfirmationEmailText comment for the reasoning.
  useEffect(() => {
    const loadGrid = async () => {
      setPhase("loading");
      try {
        const res = await fetch(`/api/specs-share/${shareId}/grid`);
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          grid?: SpecsGrid;
          projectName?: string;
          confirmationSubmittedAt?: string | null;
          confirmationSubmittedByName?: string | null;
        };
        if (!data.ok || !data.grid) {
          setLoadError(errorMessageFor(data.error));
          setPhase("load-error");
          return;
        }
        setGrid(data.grid);
        setProjectName(data.projectName || "");
        setConfirmationSubmittedAt(data.confirmationSubmittedAt || null);
        setConfirmationSubmittedByName(data.confirmationSubmittedByName || null);
        setPhase("viewing");
      } catch {
        setLoadError(errorMessageFor(undefined));
        setPhase("load-error");
      }
    };
    void loadGrid();
  }, [shareId]);

  // Replaces just one cell in a grid, leaving every other row/cell object untouched — used for
  // both the optimistic update and its revert, so neither one can ever clobber a change some
  // OTHER (independent, concurrently in-flight) cell answer already applied in between. A
  // whole-grid `previous`-snapshot revert doesn't have that property: if this cell's own request
  // fails after a different cell's answer has already landed, reverting to a snapshot captured
  // before this call started would silently discard that other, unrelated, already-successful
  // change too.
  const applyCellValue = (g: SpecsGrid, rowId: string, colIndex: number, cellValue: SpecsCell | null): SpecsGrid => ({
    ...g,
    rows: g.rows.map((r) => (r.id !== rowId ? r : { ...r, cells: r.cells.map((c, ci) => (ci === colIndex ? cellValue : c)) })),
  });

  // `value: null` means "clear this answer" — clicking an already-selected Yes/No un-selects it,
  // returning the cell to unanswered rather than just toggling between Yes and No.
  const onAnswer = async (rowId: string, colIndex: number, value: boolean | null) => {
    if (!grid) return;
    const key = `${rowId}:${colIndex}`;
    // The Yes/No buttons are disabled (see isAnswering in specs-grid-client-view.tsx) for as long
    // as answeringKey matches THIS cell, so a second click can't fire a second overlapping request
    // for the same cell — that's what actually closes the "flicks back" race, not the per-cell
    // revert below (which only guards against a DIFFERENT, legitimately-concurrent cell's answer).
    setAnsweringKey(key);
    // Only this one cell's prior value needs remembering — see applyCellValue's own comment.
    const previousCell = grid.rows.find((r) => r.id === rowId)?.cells[colIndex] ?? null;
    const nextCell: SpecsCell | null = !previousCell
      ? previousCell
      : value === null
        ? (() => {
            const cleared = { ...previousCell };
            delete cleared.confirmedYes;
            delete cleared.confirmedAt;
            return cleared;
          })()
        : { ...previousCell, confirmedYes: value, confirmedAt: new Date().toISOString() };
    setGrid((prev) => (prev ? applyCellValue(prev, rowId, colIndex, nextCell) : prev));
    try {
      const res = await fetch(`/api/specs-share/${shareId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId, colIndex, value }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!data.ok) {
        setGrid((prev) => (prev ? applyCellValue(prev, rowId, colIndex, previousCell) : prev));
      }
    } catch {
      setGrid((prev) => (prev ? applyCellValue(prev, rowId, colIndex, previousCell) : prev));
    } finally {
      setAnsweringKey((prev) => (prev === key ? null : prev));
    }
  };

  const submitConfirmation = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch(`/api/specs-share/${shareId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: submitNameDraft.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; confirmationSubmittedAt?: string };
      if (!data.ok) {
        setSubmitError(errorMessageFor(data.error));
        return;
      }
      setConfirmationSubmittedAt(data.confirmationSubmittedAt || new Date().toISOString());
      setConfirmationSubmittedByName(submitNameDraft.trim() || null);
      setShowSubmitModal(false);
    } catch {
      setSubmitError(errorMessageFor(undefined));
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasConfirmableCells = Boolean(grid?.rows.some((r) => r.cells.some((c) => c?.confirmable)));
  const locked = Boolean(confirmationSubmittedAt);
  // Same width the sheet's own "mock page" renders at (see that function's own comment) — the
  // title, both Submit bars, and the sheet itself all share this same width/left edge, rather than
  // the title sitting inside a differently-sized outer container. Undefined (not 0) before the
  // grid has loaded, so the title still renders at a sensible width during loading/error phases,
  // when there's no sheet yet to align to.
  const pageBoxWidthPx = grid ? computeSpecsPageBoxWidthPx(grid) : undefined;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F1F5F9" }}>
      <div className="mx-auto max-w-[1000px] px-4 py-8">
        <div className="overflow-x-auto">
          <div className="mx-auto" style={pageBoxWidthPx ? { width: pageBoxWidthPx } : undefined}>
            <h1 className="mb-1 text-[20px] font-bold" style={{ color: "#0F172A" }}>
              {projectName ? `Specifications — ${projectName}` : "Specifications"}
            </h1>
            <p className="mb-6 text-[13px]" style={{ color: "#64748B" }}>
              Please review the details below and confirm the highlighted items.
            </p>

            {phase === "loading" ? (
              <p className="text-[13px]" style={{ color: "#64748B" }}>Loading…</p>
            ) : phase === "load-error" ? (
              <p className="text-[13px] font-bold" style={{ color: "#B42318" }}>{loadError}</p>
            ) : grid ? (
              <>
                {locked ? (
                  <div className="mb-4 rounded-[10px] border px-4 py-3 text-[13px] font-bold" style={{ borderColor: "#15803D", backgroundColor: "#F0FDF4", color: "#15803D" }}>
                    Submitted by {confirmationSubmittedByName || "you"} on {confirmationSubmittedAt ? new Date(confirmationSubmittedAt).toLocaleDateString() : ""}. These answers are now locked.
                  </div>
                ) : hasConfirmableCells ? (
                  <div className="mb-4">
                    <SubmitBar
                      onSubmitClick={(e) => {
                        setSubmitModalOrigin(captureGlassModalOrigin(e));
                        setShowSubmitModal(true);
                      }}
                    />
                  </div>
                ) : null}

                <SpecsGridClientView grid={grid} locked={locked} onAnswer={onAnswer} answeringKey={answeringKey} />

                {!locked && hasConfirmableCells ? (
                  <div className="mt-4">
                    <SubmitBar
                      onSubmitClick={(e) => {
                        setSubmitModalOrigin(captureGlassModalOrigin(e));
                        setShowSubmitModal(true);
                      }}
                    />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>

      {shouldRenderSubmitModal ? (
        // Same "liquid glass" modal recipe every other pop-up in the app uses (see
        // app/globals.css's own comment on .glass-modal-backdrop/.glass-modal-panel), including the
        // same "grow out of the button that opened it" pop animation (useGlassModalPopOrigin) —
        // just the shared hook + class names, no extra setup, since this public page already loads
        // the same global stylesheet as the rest of the app.
        <div className="glass-modal-backdrop fixed inset-0 flex items-center justify-center px-4" style={{ zIndex: 2147483647 }}>
          {/* A plain inline backgroundColor override wins over .glass-modal-panel's own
              `background: var(--glass-modal-bg)` (equal CSS specificity, but the style attribute
              always wins) — keeps the shared blur/border/radius/shadow recipe intact for every
              OTHER modal in the app while making just this one more white-tinted, per request. */}
          <div ref={submitModalPanelRef} className="glass-modal-panel w-[min(380px,96vw)] p-5" style={{ backgroundColor: "rgba(255, 255, 255, 0.88)" }}>
            <p className="mb-2 text-[14px] font-bold" style={{ color: "#000000" }}>Submit your confirmation</p>
            <p className="mb-3 text-[12px]" style={{ color: "#000000" }}>
              Once submitted, you won&apos;t be able to change your answers. Your name is optional but helps identify who confirmed this.
            </p>
            <input
              value={submitNameDraft}
              onChange={(e) => setSubmitNameDraft(e.target.value)}
              placeholder="Your name (optional)"
              className="mb-3 h-9 w-full rounded-[8px] border px-3 text-[13px] placeholder:text-[#4B5563]"
              style={{ borderColor: "#6B7280", color: "#000000" }}
            />
            {submitError ? <p className="mb-2 text-[12px] font-bold" style={{ color: "#B42318" }}>{submitError}</p> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSubmitModal(false)}
                className="h-9 rounded-[8px] border px-4 text-[12px] font-bold"
                style={{ borderColor: "#D8DEE8", color: "#000000" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void submitConfirmation()}
                className="h-9 rounded-[8px] px-4 text-[12px] font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: "#2F6BFF" }}
              >
                {isSubmitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
