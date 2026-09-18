"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useParams } from "next/navigation";
import { ClipboardList, DollarSign as QuoteIcon, Printer, Download, User, AtSign, Phone } from "lucide-react";
import SpecsGridClientView from "@/components/specs-grid-client-view";
import { computeSpecsPageBoxWidthPx, type SpecsCell, type SpecsGrid } from "@/lib/specs-grid-types";
import { buildSpecsGridPdfBlob, openPdfBlobInPrintWindow } from "@/lib/specs-grid-pdf";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";

type Phase = "loading" | "ready" | "load-error";
type Tab = "specs" | "quote";

const ERROR_MESSAGES: Record<string, string> = {
  "not-found": "This link isn't valid. Please check the email again.",
  "project-not-found": "We couldn't find this project for this link.",
  "no-specifications-sheet": "There's no specifications sheet on this project yet.",
  "no-quote": "There's no quote on this project yet.",
  "missing-name": "Please enter your name to accept.",
};

function errorMessageFor(error: string | undefined): string {
  if (!error) return "Something went wrong. Please try again.";
  return ERROR_MESSAGES[error] ?? "Something went wrong. Please try again.";
}

// A soft "this document just hasn't been sent to this hub yet" result — never a real page-level
// error, just a signal to hide that tab entirely (see the load effect below).
function isNotSentError(error: string | undefined): boolean {
  return error === "specs-not-sent" || error === "quote-not-sent" || error === "no-specifications-sheet" || error === "no-quote";
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

// Quote's own version of SubmitBar — one big button filling the whole bar rather than a button
// alongside explanatory copy, which read as confusing/redundant (the quote itself, right above,
// already makes clear what's being accepted). Same "liquid glass" recipe as every other panel in
// the app (see app/globals.css's own comment on .glass-modal-panel) for the border/blur/shadow
// structure, but the solid #15803D green already used for the accepted banner elsewhere, not a
// translucent tint of it. Color and radius are set inline, not via the `text-white`/`rounded-[Npx]`
// utility classes, since those tie in CSS specificity with .glass-modal-panel's own `color`/
// `border-radius` (both plain single-class rules) and can lose depending on stylesheet order —
// an inline style always wins.
function AcceptBar({ onAcceptClick }: { onAcceptClick: (e: ReactMouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      onClick={onAcceptClick}
      className="glass-modal-panel flex w-full items-center justify-center px-4 py-3 text-[14px] font-bold transition hover:brightness-105"
      style={{ backgroundColor: "#15803D", borderColor: "#15803D", color: "#ffffff", borderRadius: 8 }}
    >
      Accept Quote
    </button>
  );
}

// This one link doubles as a small hub: it grows a Specifications tab and/or a Quote tab
// independently as staff sends each one (see sendSpecsToClient/sendQuoteToClient in
// app/(app)/projects/[projectId]/page.tsx). Both documents are fetched in parallel on load; a tab
// simply doesn't render at all if its document was never sent to this particular link — see
// isNotSentError below, which distinguishes that soft case from a real load error.
export default function ClientSpecsSharePage() {
  const params = useParams<{ shareId: string }>();
  const shareId = String(params?.shareId ?? "");

  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState("");
  const [projectName, setProjectName] = useState("");
  // The project's assigned staff member's own name/email/mobile (see resolveAssignedContactAdmin
  // in lib/specs-share.ts) — shown in the floating "Your point of contact" bubble. Whichever of
  // the two grid fetches below succeeds first populates this; both return the same value since
  // it's a project-level fact, not per-document.
  const [assignedContact, setAssignedContact] = useState<{ name: string; email: string; mobile: string } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("specs");
  // Sliding blue underline behind the tab bar's active tab — measured off the actual rendered
  // buttons (their labels aren't equal width) rather than an assumed fraction, so it lines up
  // exactly and slides between them on click instead of just snapping to the new tab.
  const tabButtonRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ specs: null, quote: null });
  const [tabIndicatorRect, setTabIndicatorRect] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = tabButtonRefs.current[activeTab];
    if (!el) return;
    setTabIndicatorRect({ left: el.offsetLeft, width: el.offsetWidth });
    // `phase` is in the dependency array (not just `activeTab`) on purpose: the tab buttons don't
    // exist in the DOM at all until data finishes loading and `showTabs` becomes true, so
    // `tabButtonRefs.current[activeTab]` is still null the first time this runs — on mount, before
    // `phase` becomes "ready". If `activeTab` never actually changes value after that (e.g. "specs"
    // was already the resolved default), this effect would otherwise never re-fire to measure the
    // now-real buttons, leaving the indicator permanently missing until the user's first click.
  }, [activeTab, phase]);

  const [specsAvailable, setSpecsAvailable] = useState(false);
  const [grid, setGrid] = useState<SpecsGrid | null>(null);
  const [confirmationSubmittedAt, setConfirmationSubmittedAt] = useState<string | null>(null);
  const [confirmationSubmittedByName, setConfirmationSubmittedByName] = useState<string | null>(null);
  const [answeringKey, setAnsweringKey] = useState<string | null>(null);

  const [quoteAvailable, setQuoteAvailable] = useState(false);
  const [quoteGrid, setQuoteGrid] = useState<SpecsGrid | null>(null);
  const [quoteAcceptedAt, setQuoteAcceptedAt] = useState<string | null>(null);
  const [quoteAcceptedByName, setQuoteAcceptedByName] = useState<string | null>(null);

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

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

  // Quote's own version of the submit-modal state above.
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [acceptModalOrigin, setAcceptModalOrigin] = useState<GlassModalOrigin>(null);
  const acceptModalPanelRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderAcceptModal = useGlassModalPopOrigin(showAcceptModal, acceptModalOrigin, acceptModalPanelRef);
  const [acceptNameDraft, setAcceptNameDraft] = useState("");
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  // No access code — the link itself (this shareId) is the only secret, per the user's explicit
  // call that a separate code isn't worth the friction for how unlikely the URL is to be guessed.
  // See lib/specs-share.ts's buildSpecsConfirmationEmailText comment for the reasoning.
  useEffect(() => {
    const load = async () => {
      setPhase("loading");
      try {
        const [specsData, quoteData] = await Promise.all([
          fetch(`/api/specs-share/${shareId}/grid`)
            .then((res) => res.json())
            .catch(() => ({})) as Promise<{
              ok?: boolean;
              error?: string;
              grid?: SpecsGrid;
              projectName?: string;
              assignedContact?: { name: string; email: string; mobile: string } | null;
              confirmationSubmittedAt?: string | null;
              confirmationSubmittedByName?: string | null;
            }>,
          fetch(`/api/specs-share/${shareId}/quote-grid`)
            .then((res) => res.json())
            .catch(() => ({})) as Promise<{
              ok?: boolean;
              error?: string;
              grid?: SpecsGrid;
              projectName?: string;
              assignedContact?: { name: string; email: string; mobile: string } | null;
              quoteAcceptedAt?: string | null;
              quoteAcceptedByName?: string | null;
            }>,
        ]);

        let anyAvailable = false;
        let sharedError: string | undefined;

        if (specsData.ok && specsData.grid) {
          setGrid(specsData.grid);
          setProjectName((prev) => prev || specsData.projectName || "");
          setAssignedContact((prev) => prev || specsData.assignedContact || null);
          setConfirmationSubmittedAt(specsData.confirmationSubmittedAt || null);
          setConfirmationSubmittedByName(specsData.confirmationSubmittedByName || null);
          setSpecsAvailable(true);
          anyAvailable = true;
        } else if (!isNotSentError(specsData.error)) {
          sharedError = specsData.error;
        }

        if (quoteData.ok && quoteData.grid) {
          setQuoteGrid(quoteData.grid);
          setProjectName((prev) => prev || quoteData.projectName || "");
          setAssignedContact((prev) => prev || quoteData.assignedContact || null);
          setQuoteAcceptedAt(quoteData.quoteAcceptedAt || null);
          setQuoteAcceptedByName(quoteData.quoteAcceptedByName || null);
          setQuoteAvailable(true);
          anyAvailable = true;
        } else if (!sharedError && !isNotSentError(quoteData.error)) {
          sharedError = quoteData.error;
        }

        if (!anyAvailable) {
          setLoadError(errorMessageFor(sharedError));
          setPhase("load-error");
          return;
        }
        setPhase("ready");
      } catch {
        setLoadError(errorMessageFor(undefined));
        setPhase("load-error");
      }
    };
    void load();
  }, [shareId]);

  // Defaults to whichever tab still needs action once both are known — the Quote if it's the one
  // (or one of the two) still pending, since accepting a quote is the more consequential ask.
  useEffect(() => {
    if (phase !== "ready") return;
    if (quoteAvailable && (!specsAvailable || !quoteAcceptedAt)) {
      setActiveTab("quote");
    } else if (specsAvailable) {
      setActiveTab("specs");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, specsAvailable, quoteAvailable]);

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

  const acceptQuote = async () => {
    if (isAccepting) return;
    const trimmedName = acceptNameDraft.trim();
    if (!trimmedName) {
      setAcceptError(errorMessageFor("missing-name"));
      return;
    }
    setIsAccepting(true);
    setAcceptError("");
    try {
      const res = await fetch(`/api/specs-share/${shareId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; quoteAcceptedAt?: string; quoteAcceptedByName?: string };
      if (!data.ok) {
        setAcceptError(errorMessageFor(data.error));
        return;
      }
      setQuoteAcceptedAt(data.quoteAcceptedAt || new Date().toISOString());
      setQuoteAcceptedByName(data.quoteAcceptedByName || trimmedName);
      setShowAcceptModal(false);
    } catch {
      setAcceptError(errorMessageFor(undefined));
    } finally {
      setIsAccepting(false);
    }
  };

  // Both Print and PDF reuse the EXACT same generator the staff editor's own "Print"/"Download
  // PDF" buttons use (buildSpecsGridPdfBlob/openPdfBlobInPrintWindow, extracted verbatim into
  // lib/specs-grid-pdf.ts so both places share one implementation) — a clean, vector-text PDF
  // built straight from the grid data, not a screenshot of the live page. Only image cells
  // (resolved via an authenticated-when-available Storage read) could ever look different here
  // than on staff's own copy, and only if this project's Storage rules don't allow a public read —
  // everything else (fonts, layout, pagination) is byte-for-byte identical.
  const exportActiveSheetPdf = async () => {
    const activeGrid = activeTab === "quote" ? quoteGrid : grid;
    if (!activeGrid || isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const blob = await buildSpecsGridPdfBlob(activeGrid);
      if (!blob) return;
      const label = activeTab === "quote" ? "quote" : "specifications";
      const safeProject = (projectName || label).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 64);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeProject}_${label}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2500);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const printActiveSheet = async () => {
    const activeGrid = activeTab === "quote" ? quoteGrid : grid;
    if (!activeGrid || isPrinting) return;
    setIsPrinting(true);
    try {
      const blob = await buildSpecsGridPdfBlob(activeGrid);
      if (blob) openPdfBlobInPrintWindow(blob);
    } finally {
      setIsPrinting(false);
    }
  };

  const hasConfirmableCells = Boolean(grid?.rows.some((r) => r.cells.some((c) => c?.confirmable)));
  const locked = Boolean(confirmationSubmittedAt);
  const quoteLocked = Boolean(quoteAcceptedAt);
  const showTabs = specsAvailable && quoteAvailable;
  // The LARGER of the two sheets' own natural widths — computed from BOTH grids (not just whichever
  // tab is active), so switching between Specifications and Quote never visibly resizes the page.
  // Passed straight through to SpecsGridClientView's own boxWidthPx below, which only ever widens a
  // narrower grid's box (blank margin, never rescaling/clipping its own columns) rather than the two
  // tabs rendering at two different sizes.
  const pageBoxWidthPx = Math.max(grid ? computeSpecsPageBoxWidthPx(grid) : 0, quoteGrid ? computeSpecsPageBoxWidthPx(quoteGrid) : 0) || undefined;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F1F5F9" }}>
      {/* Same glass-page-header treatment (frosted blur + bottom border) every fixed title bar in
          the main app uses (see app/globals.css's own comment), so this public page reads as part
          of the same product rather than a bare, un-styled page. Fixed, not sticky/in-flow — the
          content below gets matching top padding so nothing renders underneath it. */}
      <div className="glass-page-header fixed inset-x-0 top-0 z-50 h-[56px] px-4 md:px-6">
        {/* A 3-column grid, not flex+justify-between — the outer two columns are equal (1fr)
            tracks, so the middle (tabs) column sits at the row's true center regardless of how
            wide the project name or status chip happen to be, rather than drifting toward
            whichever side has less content. */}
        <div className="mx-auto grid h-full w-full max-w-[1000px] grid-cols-[1fr_auto_1fr] items-stretch gap-3">
          <div className="flex min-w-0 items-center gap-2 text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
            <span className="truncate">{projectName || "Project"}</span>
          </div>

          <div className="relative flex h-full items-stretch">
            {showTabs ? (
              // The tab switcher itself lives in the bar once there's more than one document to
              // switch between — moved here from a separate row in the content below, so it reads
              // as part of the same title bar every other page in the app uses, not a bolted-on
              // extra control underneath it. Full bar height, not a small pill — a real tab. The
              // underline is ONE shared absolutely-positioned element (not a per-button border) so
              // it can slide between the two buttons on click instead of just snapping over.
              <>
                {tabIndicatorRect ? (
                  <div
                    aria-hidden="true"
                    className="absolute bottom-0 h-[2px]"
                    style={{
                      left: tabIndicatorRect.left,
                      width: tabIndicatorRect.width,
                      backgroundColor: "#2F6BFF",
                      transition: "left 220ms cubic-bezier(0.34, 1.56, 0.64, 1), width 220ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                    }}
                  />
                ) : null}
                <button
                  type="button"
                  ref={(el) => {
                    tabButtonRefs.current.quote = el;
                  }}
                  onClick={() => setActiveTab("quote")}
                  className="flex h-full items-center gap-1.5 px-4 text-[12px] font-bold uppercase tracking-[0.5px]"
                  style={{ color: activeTab === "quote" ? "#2F6BFF" : "#000000" }}
                >
                  <QuoteIcon size={13} />
                  Quote
                </button>
                <button
                  type="button"
                  ref={(el) => {
                    tabButtonRefs.current.specs = el;
                  }}
                  onClick={() => setActiveTab("specs")}
                  className="flex h-full items-center gap-1.5 px-4 text-[12px] font-bold uppercase tracking-[0.5px]"
                  style={{ color: activeTab === "specs" ? "#2F6BFF" : "#000000" }}
                >
                  <ClipboardList size={13} />
                  Specifications
                </button>
              </>
            ) : (
              <div className="flex h-full items-center gap-2 text-[14px] font-bold uppercase tracking-[1px]" style={{ color: "#000000" }}>
                {activeTab === "quote" ? <QuoteIcon size={14} /> : <ClipboardList size={14} />}
                <span>{activeTab === "quote" ? "Quote" : "Specifications"}</span>
              </div>
            )}
          </div>

          <div className="flex min-w-0 items-center justify-end gap-2">
            {(activeTab === "quote" ? quoteGrid : grid) ? (
              <>
                <button
                  type="button"
                  disabled={isPrinting}
                  onClick={() => void printActiveSheet()}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 text-[11px] font-bold disabled:opacity-60"
                  style={{ borderColor: "#D8DEE8", backgroundColor: "#FFFFFF", color: "#000000" }}
                >
                  <Printer size={13} />
                  {isPrinting ? "Preparing…" : "Print"}
                </button>
                <button
                  type="button"
                  disabled={isExportingPdf}
                  onClick={() => void exportActiveSheetPdf()}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 text-[11px] font-bold disabled:opacity-60"
                  style={{ borderColor: "#D8DEE8", backgroundColor: "#FFFFFF", color: "#000000" }}
                >
                  <Download size={13} />
                  {isExportingPdf ? "Exporting…" : "PDF"}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
      {assignedContact && (assignedContact.name || assignedContact.email || assignedContact.mobile) ? (
        // Fixed to the viewport, not the content column — stays put (vertically centered on the
        // left edge) regardless of how far the sheet itself scrolls, same as a real floating help
        // widget. Hidden below a comfortably wide breakpoint (lg) rather than repositioned, since
        // there's no good place for a floating side panel on a narrow/mobile viewport without
        // covering the sheet — the contact info is still reachable there via a mailto:/tel: link
        // more naturally offered elsewhere if this ever needs a mobile-specific treatment.
        <div
          className="fixed left-4 top-1/2 z-40 hidden w-max min-w-[220px] max-w-[360px] -translate-y-1/2 rounded-[14px] border p-4 shadow-lg lg:block"
          style={{ borderColor: "#D8DEE8", backgroundColor: "#FFFFFF" }}
        >
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "#000000" }}>
            Your Point of Contact
          </p>
          <div className="space-y-2 text-[13px]" style={{ color: "#0F172A" }}>
            {assignedContact.name ? (
              <p className="flex items-center gap-2 font-bold">
                <User size={14} className="shrink-0" style={{ color: "#64748B" }} />
                <span>{assignedContact.name}</span>
              </p>
            ) : null}
            {assignedContact.email ? (
              <p className="flex items-center gap-2">
                <AtSign size={14} className="shrink-0" style={{ color: "#64748B" }} />
                <a href={`mailto:${assignedContact.email}`} className="hover:underline">
                  {assignedContact.email}
                </a>
              </p>
            ) : null}
            {assignedContact.mobile ? (
              <p className="flex items-center gap-2">
                <Phone size={14} className="shrink-0" style={{ color: "#64748B" }} />
                <a href={`tel:${assignedContact.mobile}`} className="hover:underline">
                  {assignedContact.mobile}
                </a>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="mx-auto max-w-[1000px] px-4 pb-8" style={{ paddingTop: 56 + 24 }}>
        {/* No overflow-x-auto at this level any more — it used to wrap this whole column
            (buttons/banners included), and per the CSS spec, setting overflow-x alone forces
            overflow-y to compute as "auto" too (not "visible"), silently clipping any box-shadow
            that blurs past this column's own top/bottom edge — see AcceptBar's glass shadow
            getting cut off. Horizontal scrolling is only actually needed for the wide sheet/grid
            table itself, so it's scoped to just that below instead (SpecsGridClientView's own
            wrapper), leaving buttons and banners un-clipped. */}
        <div className="mx-auto" style={pageBoxWidthPx ? { width: pageBoxWidthPx } : undefined}>
            {phase === "loading" ? (
              <p className="text-[13px]" style={{ color: "#64748B" }}>Loading…</p>
            ) : phase === "load-error" ? (
              <p className="text-[13px] font-bold" style={{ color: "#B42318" }}>{loadError}</p>
            ) : (
              <>
                {activeTab === "specs" && specsAvailable && grid ? (
                  <>
                    {locked ? (
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border px-4 py-3 text-[13px] font-bold" style={{ borderColor: "#15803D", backgroundColor: "#F0FDF4", color: "#15803D" }}>
                        <span>
                          Submitted by {confirmationSubmittedByName || "you"} on{" "}
                          {confirmationSubmittedAt
                            ? `${new Date(confirmationSubmittedAt).toLocaleDateString()} at ${new Date(confirmationSubmittedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                            : ""}
                          .
                        </span>
                        <span className="shrink-0">These answers are now locked.</span>
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

                    <div className="overflow-x-auto">
                      <SpecsGridClientView grid={grid} locked={locked} onAnswer={onAnswer} answeringKey={answeringKey} boxWidthPx={pageBoxWidthPx} />
                    </div>

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

                {activeTab === "quote" && quoteAvailable && quoteGrid ? (
                  <>
                    {quoteLocked ? (
                      <div className="mb-4 rounded-[10px] border px-4 py-3 text-[13px] font-bold" style={{ borderColor: "#15803D", backgroundColor: "#F0FDF4", color: "#15803D" }}>
                        Accepted by {quoteAcceptedByName || "you"} on{" "}
                        {quoteAcceptedAt
                          ? `${new Date(quoteAcceptedAt).toLocaleDateString()} at ${new Date(quoteAcceptedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                          : ""}
                        .
                      </div>
                    ) : (
                      <div className="mb-4">
                        <AcceptBar
                          onAcceptClick={(e) => {
                            setAcceptModalOrigin(captureGlassModalOrigin(e));
                            setShowAcceptModal(true);
                          }}
                        />
                      </div>
                    )}

                    {/* Quote has no confirmable-cell concept — always rendered locked/read-only,
                        regardless of acceptance state (accepting is a single terminal action on
                        the whole document, not a per-cell one like Specs). */}
                    <div className="overflow-x-auto">
                      <SpecsGridClientView grid={quoteGrid} locked onAnswer={() => {}} answeringKey={null} boxWidthPx={pageBoxWidthPx} />
                    </div>

                    {!quoteLocked ? (
                      <div className="mt-4">
                        <AcceptBar
                          onAcceptClick={(e) => {
                            setAcceptModalOrigin(captureGlassModalOrigin(e));
                            setShowAcceptModal(true);
                          }}
                        />
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
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

      {shouldRenderAcceptModal ? (
        <div className="glass-modal-backdrop fixed inset-0 flex items-center justify-center px-4" style={{ zIndex: 2147483647 }}>
          <div ref={acceptModalPanelRef} className="glass-modal-panel w-[min(380px,96vw)] p-5" style={{ backgroundColor: "rgba(255, 255, 255, 0.88)" }}>
            <p className="mb-2 text-[14px] font-bold" style={{ color: "#000000" }}>Accept this quote</p>
            <p className="mb-3 text-[12px]" style={{ color: "#000000" }}>
              Once accepted, this can&apos;t be undone. Please type your name to confirm.
            </p>
            <input
              value={acceptNameDraft}
              onChange={(e) => setAcceptNameDraft(e.target.value)}
              placeholder="Your name"
              className="mb-3 h-9 w-full rounded-[8px] border px-3 text-[13px] placeholder:text-[#4B5563]"
              style={{ borderColor: "#6B7280", color: "#000000" }}
            />
            {acceptError ? <p className="mb-2 text-[12px] font-bold" style={{ color: "#B42318" }}>{acceptError}</p> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAcceptModal(false)}
                className="h-9 rounded-[8px] border px-4 text-[12px] font-bold"
                style={{ borderColor: "#D8DEE8", color: "#000000" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isAccepting}
                onClick={() => void acceptQuote()}
                className="h-9 rounded-[8px] px-4 text-[12px] font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: "#15803D" }}
              >
                {isAccepting ? "Accepting…" : "Accept Quote"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
